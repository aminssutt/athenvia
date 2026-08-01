import assert from "node:assert/strict";
import { describe, it } from "node:test";

import pino from "pino";

import { verifiedLlmEvidence, type LlmDateClaim } from "./llm-extraction";
import { processParseJob, type ParseableSnapshot } from "./parse-processor";

const logger = pino({ enabled: false });

const OPTIONS = { referenceDate: new Date("2026-08-01T00:00:00.000Z"), timeZone: "UTC" };

const TABLE_PAGE =
  "<html><body><h1>Key dates</h1>" +
  "<p>August 2027 intake: 31 January 2027.</p>" +
  "</body></html>";

function claim(overrides: Partial<LlmDateClaim> = {}): LlmDateClaim {
  return {
    quote: "August 2027 intake: 31 January 2027.",
    kind: "APPLICATION_DEADLINE",
    intakeYear: 2027,
    intakeMonth: 8,
    ...overrides,
  };
}

describe("verifiedLlmEvidence", () => {
  const text = "Key dates August 2027 intake: 31 January 2027.";

  it("accepts a verbatim quote and re-derives the date deterministically", () => {
    const result = verifiedLlmEvidence([claim()], text, OPTIONS);

    assert.equal(result.rejectedQuotes, 0);
    assert.equal(result.evidence.length, 1);
    const item = result.evidence[0]!;
    assert.equal(item.candidate.localDate, "2027-01-31");
    assert.equal(item.candidate.kind, "APPLICATION_DEADLINE");
    assert.equal(item.candidate.automaticPublication, true);
    assert.deepEqual(item.intakeHint, { year: 2027, month: 8 });
  });

  it("rejects quotes that are not literally present in the text", () => {
    const result = verifiedLlmEvidence(
      [claim({ quote: "Applications close on 31 January 2027." })],
      text,
      OPTIONS,
    );
    assert.equal(result.evidence.length, 0);
    assert.equal(result.rejectedQuotes, 1);
  });

  it("rejects quotes whose date the parser cannot pin to an exact day", () => {
    const result = verifiedLlmEvidence([claim({ quote: "August 2027 intake:" })], text, OPTIONS);
    assert.equal(result.evidence.length, 0);
    assert.equal(result.rejectedQuotes, 1);
  });

  it("rejects claims that contradict the parser's own reading", () => {
    const contradictingText = "Applications close on 31 January 2027.";
    const result = verifiedLlmEvidence(
      [claim({ quote: contradictingText, kind: "APPLICATION_OPEN" })],
      contradictingText,
      OPTIONS,
    );
    assert.equal(result.evidence.length, 0);
    assert.equal(result.rejectedQuotes, 1);
  });

  it("matches quotes across whitespace differences but never across rewrites", () => {
    const spaced = "August 2027   intake:\n31 January 2027.";
    const result = verifiedLlmEvidence([claim()], spaced, OPTIONS);
    assert.equal(result.evidence.length, 1);
  });
});

describe("processParseJob with an LLM extractor", () => {
  const windowId = "22222222-2222-4222-8222-222222222222";
  const snapshot: ParseableSnapshot = {
    id: "33333333-3333-4333-8333-333333333333",
    sourceId: "44444444-4444-4444-8444-444444444444",
    storageKey: "source-snapshots/x/y.bin",
    universityCountryCode: "SG",
    programName: "MSc Example",
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

  it("publishes a citation-verified claim when the deterministic pass finds nothing", async () => {
    const proposals: unknown[] = [];
    const extractorInputs: unknown[] = [];
    const result = await processParseJob(snapshot.id, {
      createRevision: async (_snapshot, proposal) => {
        proposals.push(proposal);
        return { outcome: "PENDING", revisionId: "66666666-6666-4666-8666-666666666666" };
      },
      enqueueReview: async () => {},
      llmExtractor: async (input) => {
        extractorInputs.push(input);
        return [claim()];
      },
      loadSnapshot: async () => snapshot,
      logger,
      now: () => new Date("2026-08-01T00:00:00.000Z"),
      readSnapshotBody: async () => Buffer.from(TABLE_PAGE),
    });

    assert.equal(result.revisionsCreated, 1);
    assert.equal(extractorInputs.length, 1);
    assert.deepEqual(proposals[0], {
      currentValue: null,
      entityId: windowId,
      fieldName: "closesAt",
      proposedValue: "2027-01-31T12:00:00.000Z",
    });
  });

  it("does not call the model when the deterministic pass already published", async () => {
    let llmCalls = 0;
    const result = await processParseJob(snapshot.id, {
      createRevision: async () => ({
        outcome: "PENDING",
        revisionId: "66666666-6666-4666-8666-666666666666",
      }),
      enqueueReview: async () => {},
      llmExtractor: async () => {
        llmCalls += 1;
        return [];
      },
      loadSnapshot: async () => snapshot,
      logger,
      now: () => new Date("2026-08-01T00:00:00.000Z"),
      readSnapshotBody: async () =>
        Buffer.from(
          "<html><body><p>Applications for the August 2027 intake close on 31 January 2027.</p></body></html>",
        ),
    });

    assert.equal(result.revisionsCreated, 1);
    assert.equal(llmCalls, 0);
  });

  it("degrades to the deterministic result when the model is unavailable", async () => {
    const result = await processParseJob(snapshot.id, {
      createRevision: async () => ({ outcome: "PENDING", revisionId: null }),
      enqueueReview: async () => {},
      llmExtractor: async () => {
        throw new Error("model unavailable");
      },
      loadSnapshot: async () => snapshot,
      logger,
      now: () => new Date("2026-08-01T00:00:00.000Z"),
      readSnapshotBody: async () => Buffer.from(TABLE_PAGE),
    });

    assert.equal(result.outcome, "PARSED");
    assert.equal(result.revisionsCreated, 0);
  });
});
