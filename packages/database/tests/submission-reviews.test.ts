import assert from "node:assert/strict";
import test from "node:test";

import { createSubmissionReview, SUBMISSION_REVIEW_FIELD } from "../src/submission-reviews";

test("creates one pending auditable review for every proposed shared record", async () => {
  const writes: unknown[] = [];
  const client = {
    dataRevision: {
      create: async (args: unknown) => {
        writes.push(args);
        return { id: "review-1" };
      },
    },
  } as never;

  const id = await createSubmissionReview(
    client,
    "UNIVERSITY_SUBMISSION",
    "submission-1",
    "user-1",
    { countryCode: "FR", name: "Example University" },
  );

  assert.equal(id, "review-1");
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0], {
    data: {
      createdByWorker: true,
      entityId: "submission-1",
      entityType: "UNIVERSITY_SUBMISSION",
      fieldName: SUBMISSION_REVIEW_FIELD,
      newValue: {
        proposedRecord: { countryCode: "FR", name: "Example University" },
        submittedByUserId: "user-1",
      },
    },
    select: { id: true },
  });
});
