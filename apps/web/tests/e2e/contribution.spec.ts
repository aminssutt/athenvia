import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import {
  cleanupContributedUniversities,
  createAuthenticatedActor,
  deleteActor,
  deleteActorSessions,
  deleteActorsByEmailPrefix,
  findPublishedUniversity,
  findUniversitySubmission,
  resetUniversitySubmissionRateLimit,
  signInContext,
  type AuthenticatedActor,
} from "./helpers/db";
import { databaseAvailable, E2E_ADMIN_EMAIL, E2E_BASE_URL } from "./helpers/test-env";

/**
 * P5-04 — University contribution pass (#95).
 *
 * The submission API, review queue, approval and publication pipeline are
 * exercised end to end. The contribute FORM currently never reaches the API
 * (see the expected-failure test below), so the pipeline journey drives the
 * documented API contract directly with a real signed-in session.
 */

const RUN_ID = randomUUID().slice(0, 8);
const UNIVERSITY_NAME_PREFIX = "E2E Contributed University";
const UNIVERSITY_NAME = `${UNIVERSITY_NAME_PREFIX} ${RUN_ID}`;
// Liechtenstein keeps the duplicate detector away from the seeded catalogue.
const UNIVERSITY_COUNTRY = "Liechtenstein";

test.describe("university contribution", () => {
  // The journeys share the contributor/admin accounts and the review queue
  // state; running them in one ordered worker avoids cross-test races.
  test.describe.configure({ mode: "serial" });
  test.skip(!databaseAvailable, "Requires the catalogue database (DATABASE_URL).");

  let contributor: AuthenticatedActor;
  let admin: AuthenticatedActor;

  test.beforeAll(async () => {
    await resetUniversitySubmissionRateLimit();
    contributor = await createAuthenticatedActor(`e2e-contributor-${RUN_ID}@athenvia.example`);
    admin = await createAuthenticatedActor(E2E_ADMIN_EMAIL);
  });

  test.afterAll(async () => {
    await cleanupContributedUniversities(UNIVERSITY_NAME_PREFIX);
    await deleteActorsByEmailPrefix("e2e-contributor-");
    if (contributor) {
      await deleteActor(contributor);
    }
    if (admin) {
      // The reviewer account stays: data_revisions.created_by_user_id is
      // ON DELETE RESTRICT once it has approved a revision.
      await deleteActorSessions(admin);
    }
  });

  /**
   * KNOWN DEFECT — the contribute form never calls the submission API:
   * app/(app)/contribute/university/missing-university-form.tsx:70 calls
   * submitMissingUniversity without a transport, and submission.ts:70 then
   * always answers "unavailable". Once the form is wired to
   * POST /api/university-submissions this test will report "passed
   * unexpectedly": remove the test.fail() marker at that moment.
   */
  test("lets a signed-in student send an unknown university from the form", async ({
    context,
    page,
  }) => {
    test.fail();

    await signInContext(context, contributor, E2E_BASE_URL);
    await page.goto("/contribute/university");

    await expect(page.getByRole("heading", { name: "Add a missing university" })).toBeVisible();
    await page.getByLabel("University name").fill(`${UNIVERSITY_NAME} Form`);
    await page.getByLabel("Country").fill(UNIVERSITY_COUNTRY);
    await page.getByRole("button", { name: "Send for review" }).click();

    await expect(page.getByRole("heading", { name: "Sent for review" })).toBeVisible();
  });

  test("accepts, reviews, approves, publishes and reuses an unknown university", async ({
    browser,
    context,
    page,
  }) => {
    test.setTimeout(120_000);
    await signInContext(context, contributor, E2E_BASE_URL);
    // Warm any page so the request context carries the session cookie.
    await page.goto("/home");

    // 1. The signed-in student submits an unknown university (API contract
    //    of the contribute form).
    const submissionResponse = await page.request.post("/api/university-submissions", {
      data: { universityName: UNIVERSITY_NAME, country: UNIVERSITY_COUNTRY },
      headers: { origin: E2E_BASE_URL },
    });
    expect(submissionResponse.status()).toBe(201);
    const submissionBody = (await submissionResponse.json()) as {
      status: string;
      submissionId: string;
    };
    expect(submissionBody.status).toBe("pending_review");

    // 2. The submission is stored as PENDING until a human decision.
    expect((await findUniversitySubmission(UNIVERSITY_NAME))?.status).toBe("PENDING");

    // 3. The admin review queue shows the pending state with its evidence.
    const adminContext = await browser.newContext({ baseURL: E2E_BASE_URL });
    try {
      await signInContext(adminContext, admin, E2E_BASE_URL);
      const adminPage = await adminContext.newPage();
      await adminPage.goto("/admin");

      await expect(adminPage.getByRole("heading", { name: "Review queue" })).toBeVisible();
      const reviewCard = adminPage.locator("article", {
        hasText: UNIVERSITY_NAME,
      });
      await expect(reviewCard).toHaveCount(1);
      await expect(reviewCard).toContainText("UNIVERSITY SUBMISSION");
      await expect(reviewCard).toContainText("submissionReview");
      await expect(reviewCard).toContainText("Pending");
      // KNOWN DEFECT — provenance: the card reads "Proposed by Athenvia
      // verification worker" although a student submitted this record
      // (createSubmissionReview stores createdByWorker: true and no
      // createdByUserId; packages/database/src/submission-reviews.ts:16).
      // The contributor only appears as a raw user id inside the payload.
      await expect(reviewCard).toContainText(contributor.userId);

      // 4. Approving records the decision and clears the card. When the
      //    approved card was the last one, ReviewQueue swaps to the empty
      //    state and the confirmation message is not rendered (see
      //    review-queue.tsx:43), so both outcomes are accepted here.
      await reviewCard.getByRole("button", { name: "Approve" }).click();
      await expect(
        adminPage
          .getByText("Revision approved and audited.")
          .or(adminPage.getByRole("heading", { name: "Queue clear" })),
      ).toBeVisible();
      await expect(reviewCard).toHaveCount(0);
      await expect
        .poll(async () => (await findUniversitySubmission(UNIVERSITY_NAME))?.status)
        .toBe("APPROVED");

      // 5. Publication turns the approved submission into a catalogue record.
      const publicationResponse = await adminPage.request.post(
        `/api/admin/publications/university/${submissionBody.submissionId}`,
        { headers: { origin: E2E_BASE_URL } },
      );
      expect(publicationResponse.status()).toBe(200);
      const publication = (await publicationResponse.json()) as {
        entityId: string | null;
        outcome: string;
      };
      expect(publication.outcome).toBe("PUBLISHED");
      expect(publication.entityId).not.toBeNull();

      const university = await findPublishedUniversity(UNIVERSITY_NAME);
      expect(university?.status).toBe("ACTIVE");

      // 6. The published record is reusable: submitting the same university
      //    again is now caught by the duplicate detection, which files a
      //    worker-created review against the catalogue record.
      const duplicateResponse = await page.request.post("/api/university-submissions", {
        data: { universityName: UNIVERSITY_NAME, country: UNIVERSITY_COUNTRY },
        headers: { origin: E2E_BASE_URL },
      });
      expect(duplicateResponse.status()).toBe(201);

      await adminPage.goto("/admin");
      const duplicateCard = adminPage.locator("article", {
        hasText: "duplicate_candidates",
      });
      await expect(duplicateCard).toHaveCount(1);
      await expect(duplicateCard).toContainText("Athenvia verification worker");
      await expect(duplicateCard).toContainText(publication.entityId as string);
    } finally {
      await adminContext.close();
    }
  });

  test("hides the review queue from non-admin accounts", async ({ context, page }) => {
    await signInContext(context, contributor, E2E_BASE_URL);

    const response = await page.goto("/admin");

    // resolveAdminAccess answers notFound() for signed-in non-admins.
    expect(response?.status()).toBe(404);
  });
});
