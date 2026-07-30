import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { sourceSnapshotStorageKey } from "../src/source-snapshots";

const sourceId = "0b5fc507-68e9-4b0e-9167-617757dcdd0e";
const digest = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";

describe("source snapshot identity", () => {
  it("derives the only valid object key from source and canonical hash", () => {
    assert.equal(
      sourceSnapshotStorageKey({
        sourceId,
        contentHash: `sha256:${digest}`,
      }),
      `source-snapshots/${sourceId}/${digest}.bin`,
    );
  });

  it("rejects malformed, uppercase, or non-SHA-256 identities", () => {
    for (const contentHash of [
      digest,
      `sha1:${digest}`,
      `sha256:${digest.toUpperCase()}`,
      "sha256:abc",
    ]) {
      assert.throws(() =>
        sourceSnapshotStorageKey({
          sourceId,
          contentHash,
        }),
      );
    }
  });

  it("rejects invalid source identifiers and unexpected fields", () => {
    assert.throws(() =>
      sourceSnapshotStorageKey({
        sourceId: "not-a-uuid",
        contentHash: `sha256:${digest}`,
      }),
    );
    assert.throws(() =>
      sourceSnapshotStorageKey({
        sourceId,
        contentHash: `sha256:${digest}`,
        unexpected: true,
      } as never),
    );
  });
});
