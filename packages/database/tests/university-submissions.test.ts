import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createPendingUniversitySubmission,
  findAuthenticatedUserIdByEmail,
} from "../src/university-submissions";
import type { PendingUniversitySubmissionInput } from "../src/university-submissions";

const userId = "0b5fc507-68e9-4b0e-9167-617757dcdd0e";

describe("university submission persistence", () => {
  it("resolves the stable owner ID from the Auth.js email", async () => {
    const calls: string[] = [];
    const result = await findAuthenticatedUserIdByEmail("student@example.test", async (email) => {
      calls.push(email);
      return { id: userId };
    });

    assert.equal(result, userId);
    assert.deepEqual(calls, ["student@example.test"]);
  });

  it("persists an explicit pending submission owned by that user", async () => {
    const input = {
      submittedByUserId: userId,
      name: "Example University",
      countryCode: "FR",
      officialWebsite: "https://example.edu/",
    };
    const writes: PendingUniversitySubmissionInput[] = [];

    const result = await createPendingUniversitySubmission(input, async (data) => {
      writes.push(data);
      return {
        id: "a58be0c4-9abe-44bd-aed1-388eb603b939",
        status: "PENDING",
      };
    });

    assert.equal(result.status, "PENDING");
    assert.deepEqual(writes, [input]);
  });

  it("rejects non-ISO country codes before writing", async () => {
    let wrote = false;

    await assert.rejects(
      createPendingUniversitySubmission(
        {
          submittedByUserId: userId,
          name: "Example University",
          countryCode: "France",
          officialWebsite: null,
        },
        async () => {
          wrote = true;
          return {
            id: "a58be0c4-9abe-44bd-aed1-388eb603b939",
            status: "PENDING",
          };
        },
      ),
    );

    assert.equal(wrote, false);
  });
});
