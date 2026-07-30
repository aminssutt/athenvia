import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DiscoveryJobDataSchema,
  FetchJobDataSchema,
  ParseJobDataSchema,
  ReviewJobDataSchema,
  verificationQueueContracts,
} from "../src/queue-contracts";

const identifiers = {
  submissionId: "a58be0c4-9abe-44bd-aed1-388eb603b939",
  sourceId: "c679f920-bf74-4d5a-b7ef-80a0e7875f4c",
  sourceSnapshotId: "e978ae65-3159-42d4-bf08-ccbc4f8a77b3",
  revisionId: "a36c01ef-dc33-4b3c-937b-fbef8ce01e3f",
};

describe("verification queue payloads", () => {
  it("accepts one stable identifier for every stage", () => {
    assert.deepEqual(DiscoveryJobDataSchema.parse({ submissionId: identifiers.submissionId }), {
      submissionId: identifiers.submissionId,
    });
    assert.deepEqual(FetchJobDataSchema.parse({ sourceId: identifiers.sourceId }), {
      sourceId: identifiers.sourceId,
    });
    assert.deepEqual(ParseJobDataSchema.parse({ sourceSnapshotId: identifiers.sourceSnapshotId }), {
      sourceSnapshotId: identifiers.sourceSnapshotId,
    });
    assert.deepEqual(ReviewJobDataSchema.parse({ revisionId: identifiers.revisionId }), {
      revisionId: identifiers.revisionId,
    });
  });

  it("rejects content, URLs and unknown fields", () => {
    assert.equal(
      DiscoveryJobDataSchema.safeParse({
        submissionId: identifiers.submissionId,
        submittedUrl: "https://example.edu/program",
      }).success,
      false,
    );
    assert.equal(
      FetchJobDataSchema.safeParse({
        sourceId: identifiers.sourceId,
        url: "https://example.edu/program",
      }).success,
      false,
    );
    assert.equal(
      ParseJobDataSchema.safeParse({
        sourceSnapshotId: identifiers.sourceSnapshotId,
        html: "<main>content</main>",
      }).success,
      false,
    );
    assert.equal(
      ReviewJobDataSchema.safeParse({
        revisionId: identifiers.revisionId,
        extractedText: "deadline",
      }).success,
      false,
    );
  });

  it("uses unique, stable queue and job names", () => {
    const contracts = Object.values(verificationQueueContracts);

    assert.equal(new Set(contracts.map(({ queueName }) => queueName)).size, contracts.length);
    assert.equal(new Set(contracts.map(({ jobName }) => jobName)).size, contracts.length);
    assert.equal(
      new Set(contracts.map(({ deadLetterJobName }) => deadLetterJobName)).size,
      contracts.length,
    );
  });
});
