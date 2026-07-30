import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canonicalSourceContentHash,
  storeSourceSnapshot,
  type ImmutableSnapshotObject,
} from "./source-snapshots";

const sourceId = "0b5fc507-68e9-4b0e-9167-617757dcdd0e";
const capturedAt = new Date("2026-07-30T12:00:00.000Z");
const helloHash = "sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
const helloKey =
  "source-snapshots/0b5fc507-68e9-4b0e-9167-617757dcdd0e/2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824.bin";

describe("source snapshot storage", () => {
  it("derives a canonical SHA-256 digest from the exact fetched bytes", () => {
    assert.equal(canonicalSourceContentHash(Buffer.from("hello")), helloHash);
    assert.notEqual(canonicalSourceContentHash(Buffer.from("hello\n")), helloHash);
  });

  it("stores immutable bytes before recording linked evidence", async () => {
    const calls: string[] = [];
    const objects: ImmutableSnapshotObject[] = [];

    const result = await storeSourceSnapshot(
      {
        body: Buffer.from("hello"),
        capturedAt,
        contentType: "text/html",
        sourceId,
      },
      {
        objectStore: {
          putIfAbsent: async (object) => {
            calls.push("object");
            objects.push(object);
            return { created: true };
          },
        },
        persistSnapshot: async (input) => {
          calls.push("database");
          assert.deepEqual(input, {
            capturedAt,
            contentHash: helloHash,
            sourceId,
          });
          return {
            created: true,
            snapshot: {
              id: "5bd680ef-09be-4030-b917-4df1531372b9",
              sourceId,
              storageKey: helloKey,
              contentHash: helloHash,
              capturedAt,
              source: {
                universityId: "9708c9b1-c59d-41d3-9ba0-d9a9e5402bf0",
                programId: null,
              },
            },
          };
        },
      },
    );

    assert.deepEqual(calls, ["object", "database"]);
    assert.equal(result.created, true);
    assert.equal(result.objectCreated, true);
    assert.equal(objects[0]?.key, helloKey);
    assert.equal(objects[0]?.contentHash, helloHash);
    assert.equal(objects[0]?.body.toString(), "hello");
  });

  it("is idempotent when both immutable object and evidence already exist", async () => {
    const result = await storeSourceSnapshot(
      {
        body: Buffer.from("hello"),
        capturedAt,
        contentType: "text/html",
        sourceId,
      },
      {
        objectStore: {
          putIfAbsent: async () => ({ created: false }),
        },
        persistSnapshot: async () => ({
          created: false,
          snapshot: {
            id: "5bd680ef-09be-4030-b917-4df1531372b9",
            sourceId,
            storageKey: helloKey,
            contentHash: helloHash,
            capturedAt,
            source: {
              universityId: null,
              programId: "9708c9b1-c59d-41d3-9ba0-d9a9e5402bf0",
            },
          },
        }),
      },
    );

    assert.equal(result.created, false);
    assert.equal(result.objectCreated, false);
  });

  it("does not record evidence when immutable object storage fails", async () => {
    let persisted = false;

    await assert.rejects(
      storeSourceSnapshot(
        {
          body: Buffer.from("hello"),
          capturedAt,
          contentType: "text/html",
          sourceId,
        },
        {
          objectStore: {
            putIfAbsent: async () => {
              throw new Error("object storage unavailable");
            },
          },
          persistSnapshot: async () => {
            persisted = true;
            throw new Error("must not be called");
          },
        },
      ),
      /object storage unavailable/u,
    );

    assert.equal(persisted, false);
  });

  it("fails before storage for invalid source identities", async () => {
    let stored = false;

    await assert.rejects(
      storeSourceSnapshot(
        {
          body: Buffer.from("hello"),
          capturedAt,
          contentType: "text/html",
          sourceId: "not-a-uuid",
        },
        {
          objectStore: {
            putIfAbsent: async () => {
              stored = true;
              return { created: true };
            },
          },
        },
      ),
    );

    assert.equal(stored, false);
  });
});
