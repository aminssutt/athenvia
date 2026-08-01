import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import pino from "pino";

import { sourceSnapshotStorageKey } from "@athenvia/database";

import { approvedHostsForSource, processFetchJob } from "./fetch-processor";
import { FilesystemSnapshotStore } from "./filesystem-snapshot-store";
import { candidateInstant, processParseJob } from "./parse-processor";
import { runSourceRecheckSweep } from "./recheck-sweep";
import { processReviewJob } from "./review-processor";

import type { DateCandidate } from "../parsing";
import type { FetchableSource, FetchProcessorDependencies } from "./fetch-processor";
import type { ParseableSnapshot, ParseProcessorDependencies } from "./parse-processor";

const logger = pino({ enabled: false });

function fakeCandidate(overrides: Partial<DateCandidate> = {}): DateCandidate {
  return {
    alternatives: [],
    automaticPublication: true,
    end: 10,
    kind: "APPLICATION_DEADLINE",
    localDate: "2027-01-31",
    localTime: null,
    precision: "DATE",
    reviewReasons: [],
    sourceText: "31 January 2027",
    start: 0,
    timeZone: "UTC",
    timeZoneSource: "configured",
    ...overrides,
  };
}

describe("FilesystemSnapshotStore", () => {
  it("creates an object once and refuses to overwrite it", async () => {
    const store = new FilesystemSnapshotStore(mkdtempSync(join(tmpdir(), "athenvia-snap-")));
    const object = {
      body: Buffer.from("first"),
      contentHash: "sha256:aa",
      contentType: "text/html",
      key: "source-snapshots/a/b.bin",
    };

    assert.deepEqual(await store.putIfAbsent(object), { created: true });
    assert.deepEqual(await store.putIfAbsent({ ...object, body: Buffer.from("second") }), {
      created: false,
    });
    assert.equal((await store.read(object.key)).toString("utf8"), "first");
  });

  it("rejects keys that escape the storage root", async () => {
    const store = new FilesystemSnapshotStore(mkdtempSync(join(tmpdir(), "athenvia-snap-")));
    await assert.rejects(
      store.putIfAbsent({
        body: Buffer.from("x"),
        contentHash: "sha256:aa",
        contentType: "text/html",
        key: "../escape.bin",
      }),
      TypeError,
    );
  });
});

describe("approvedHostsForSource", () => {
  it("combines the source host with the university domain", () => {
    const source: FetchableSource = {
      id: "s",
      url: "https://admissions.example.edu/dates",
      isOfficial: true,
      contentHash: null,
      universityOfficialDomain: "example.edu",
    };
    assert.deepEqual(approvedHostsForSource(source), [
      "admissions.example.edu",
      "example.edu",
      "www.example.edu",
    ]);
  });
});

describe("processFetchJob", () => {
  const source: FetchableSource = {
    id: "11111111-1111-4111-8111-111111111111",
    url: "https://www.example.edu/apply",
    isOfficial: true,
    contentHash: null,
    universityOfficialDomain: "example.edu",
  };

  const snapshotId = "77777777-7777-4777-8777-777777777777";

  function dependencies(
    overrides: Partial<FetchProcessorDependencies> = {},
  ): FetchProcessorDependencies & { calls: Record<string, unknown[]> } {
    const calls: Record<string, unknown[]> = { check: [], parse: [] };
    return {
      calls,
      enqueueParse: async (id) => {
        calls.parse!.push(id);
      },
      fetchOfficialSource: async () => ({
        body: Buffer.from("<html><body>Apply by 31 January 2027</body></html>"),
        contentType: "text/html",
        finalUrl: source.url,
        status: 200,
      }),
      loadSource: async () => source,
      logger,
      objectStore: { putIfAbsent: async () => ({ created: true }) },
      persistSnapshot: async (input) => ({
        created: true,
        snapshot: {
          id: snapshotId,
          sourceId: input.sourceId,
          storageKey: sourceSnapshotStorageKey({
            sourceId: input.sourceId,
            contentHash: input.contentHash,
          }),
          contentHash: input.contentHash,
          capturedAt: input.capturedAt,
          source: { universityId: null, programId: null },
        },
      }),
      recordSourceCheck: async (...values) => {
        calls.check!.push(values);
      },
      ...overrides,
    };
  }

  it("records the snapshot and enqueues parsing for new content", async () => {
    const deps = dependencies();
    const result = await processFetchJob(source.id, deps);

    assert.equal(result.outcome, "FETCHED");
    assert.equal(result.sourceSnapshotId, snapshotId);
    assert.deepEqual(deps.calls.parse, [snapshotId]);
    assert.equal(deps.calls.check!.length, 1);
    assert.equal((deps.calls.check![0] as unknown[])[2], 200);
  });

  it("re-checks unchanged content without any downstream work", async () => {
    const body = Buffer.from("<html><body>Apply by 31 January 2027</body></html>");
    const { canonicalSourceContentHash } = await import("../source-snapshots");
    const deps = dependencies({
      loadSource: async () => ({ ...source, contentHash: canonicalSourceContentHash(body) }),
      objectStore: { putIfAbsent: async () => ({ created: false }) },
      persistSnapshot: async (input) => ({
        created: false,
        snapshot: {
          id: snapshotId,
          sourceId: input.sourceId,
          storageKey: sourceSnapshotStorageKey({
            sourceId: input.sourceId,
            contentHash: input.contentHash,
          }),
          contentHash: input.contentHash,
          capturedAt: input.capturedAt,
          source: { universityId: null, programId: null },
        },
      }),
    });
    const result = await processFetchJob(source.id, deps);

    assert.equal(result.outcome, "UNCHANGED");
    assert.deepEqual(deps.calls.parse, []);
  });

  it("skips sources that are not official", async () => {
    const deps = dependencies({ loadSource: async () => ({ ...source, isOfficial: false }) });
    const result = await processFetchJob(source.id, deps);
    assert.equal(result.outcome, "SKIPPED");
    assert.equal(deps.calls.parse!.length, 0);
  });

  it("records the failed check before propagating a fetch error", async () => {
    const deps = dependencies({
      fetchOfficialSource: async () => {
        throw new Error("network down");
      },
    });
    await assert.rejects(processFetchJob(source.id, deps), /network down/u);
    assert.equal(deps.calls.check!.length, 1);
    assert.deepEqual((deps.calls.check![0] as unknown[])[2], null);
  });

  it("does not parse non-success HTTP responses", async () => {
    const deps = dependencies({
      fetchOfficialSource: async () => ({
        body: Buffer.from("gone"),
        contentType: "text/html",
        finalUrl: source.url,
        status: 404,
      }),
    });
    const result = await processFetchJob(source.id, deps);
    assert.equal(result.outcome, "SKIPPED");
    assert.equal(deps.calls.parse!.length, 0);
  });
});

describe("candidateInstant", () => {
  it("normalises a published day to noon UTC", () => {
    assert.equal(candidateInstant(fakeCandidate()), "2027-01-31T12:00:00.000Z");
  });

  it("keeps an explicit UTC time", () => {
    assert.equal(
      candidateInstant(
        fakeCandidate({ localTime: "23:59", precision: "DATE_TIME", timeZone: "UTC" }),
      ),
      "2027-01-31T23:59:00.000Z",
    );
  });

  it("refuses to guess for month precision or non-UTC times", () => {
    assert.equal(candidateInstant(fakeCandidate({ localDate: null, precision: "MONTH" })), null);
    assert.equal(
      candidateInstant(
        fakeCandidate({
          localTime: "23:59",
          precision: "DATE_TIME",
          timeZone: "Asia/Singapore",
        }),
      ),
      null,
    );
  });
});

describe("processParseJob", () => {
  const windowId = "22222222-2222-4222-8222-222222222222";
  const snapshot: ParseableSnapshot = {
    id: "33333333-3333-4333-8333-333333333333",
    sourceId: "44444444-4444-4444-8444-444444444444",
    storageKey: "source-snapshots/x/y.bin",
    universityCountryCode: "SG",
    intakes: [
      {
        id: "55555555-5555-4555-8555-555555555555",
        year: 2027,
        month: 8,
        startDate: null,
        applicationWindows: [{ id: windowId, roundName: null, opensAt: null, closesAt: null }],
      },
    ],
  };

  function dependencies(
    overrides: Partial<ParseProcessorDependencies> = {},
  ): ParseProcessorDependencies & { proposals: unknown[]; reviews: string[] } {
    const proposals: unknown[] = [];
    const reviews: string[] = [];
    return {
      proposals,
      reviews,
      createRevision: async (_snapshot, proposal) => {
        proposals.push(proposal);
        return { outcome: "PENDING", revisionId: "66666666-6666-4666-8666-666666666666" };
      },
      enqueueReview: async (revisionId) => {
        reviews.push(revisionId);
      },
      loadSnapshot: async () => snapshot,
      logger,
      now: () => new Date("2026-08-01T00:00:00.000Z"),
      readSnapshotBody: async () =>
        Buffer.from(
          "<html><body><h1>Admissions</h1>" +
            "<p>Applications for the August 2027 intake close on 31 January 2027.</p>" +
            "</body></html>",
        ),
      ...overrides,
    };
  }

  it("turns a published deadline into a pending window revision", async () => {
    const deps = dependencies();
    const result = await processParseJob(snapshot.id, deps);

    assert.equal(result.outcome, "PARSED");
    assert.equal(result.revisionsCreated, 1);
    assert.deepEqual(deps.proposals[0], {
      currentValue: null,
      entityId: windowId,
      fieldName: "closesAt",
      proposedValue: "2027-01-31T12:00:00.000Z",
    });
    assert.deepEqual(deps.reviews, ["66666666-6666-4666-8666-666666666666"]);
  });

  it("proposes nothing when the canonical value already matches", async () => {
    const deps = dependencies({
      loadSnapshot: async () => ({
        ...snapshot,
        intakes: [
          {
            ...snapshot.intakes[0]!,
            applicationWindows: [
              {
                id: windowId,
                roundName: null,
                opensAt: null,
                closesAt: new Date("2027-01-31T12:00:00.000Z"),
              },
            ],
          },
        ],
      }),
    });
    const result = await processParseJob(snapshot.id, deps);
    assert.equal(result.revisionsCreated, 0);
    assert.equal(deps.proposals.length, 0);
  });

  it("skips snapshots without programme intakes", async () => {
    const deps = dependencies({
      loadSnapshot: async () => ({ ...snapshot, intakes: [] }),
    });
    const result = await processParseJob(snapshot.id, deps);
    assert.equal(result.outcome, "SKIPPED");
  });
});

describe("processReviewJob", () => {
  it("confirms a pending revision reached the admin queue", async () => {
    const result = await processReviewJob("r-1", {
      loadRevision: async () => ({
        id: "r-1",
        changeStatus: "PENDING",
        entityType: "APPLICATION_WINDOW",
        fieldName: "closesAt",
        hasConflict: false,
      }),
      logger,
    });
    assert.equal(result.outcome, "PENDING_ADMIN");
  });

  it("leaves already-decided revisions untouched", async () => {
    const result = await processReviewJob("r-1", {
      loadRevision: async () => ({
        id: "r-1",
        changeStatus: "APPROVED",
        entityType: "APPLICATION_WINDOW",
        fieldName: "closesAt",
        hasConflict: false,
      }),
      logger,
    });
    assert.equal(result.outcome, "ALREADY_DECIDED");
  });
});

describe("runSourceRecheckSweep", () => {
  it("enqueues stale sources with a per-day dedupe key", async () => {
    const enqueued: Array<[string, string]> = [];
    const result = await runSourceRecheckSweep(
      { batchSize: 10, recheckDays: 7 },
      {
        enqueueFetch: async (sourceId, dedupeKey) => {
          enqueued.push([sourceId, dedupeKey]);
        },
        findStaleSources: async (checkedBefore) => {
          assert.equal(checkedBefore.toISOString(), "2026-07-25T00:00:00.000Z");
          return [{ id: "s-1" }, { id: "s-2" }];
        },
        logger,
        now: () => new Date("2026-08-01T00:00:00.000Z"),
      },
    );
    assert.equal(result.enqueued, 2);
    assert.deepEqual(enqueued, [
      ["s-1", "fetch:s-1:2026-08-01"],
      ["s-2", "fetch:s-2:2026-08-01"],
    ]);
  });
});
