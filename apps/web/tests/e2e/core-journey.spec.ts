import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import {
  createAuthenticatedActor,
  deleteActor,
  countWatchlistRows,
  findFollowableProgram,
  signInContext,
  type AuthenticatedActor,
  type FollowableProgram,
} from "./helpers/db";
import { databaseAvailable, E2E_BASE_URL } from "./helpers/test-env";

/**
 * P5-02 — First launch, search, Follow pass (#93).
 *
 * Follow requires an authenticated session (see app/api/watchlist/route.ts).
 * Magic-link email cannot be automated, so the signed-in state is seeded the
 * same way NextAuth's database strategy stores it: a Session row plus the
 * next-auth.session-token cookie.
 */

const JOURNEY_BUDGET_MS = 60_000;

// Exact user-facing copy from packages/contracts/src/domain.ts (publicDateCopy).
const DATE_STATUS_TITLES = ["Confirmed by the university", "Expected date", "Not published yet"];
const DATE_STATUS_DESCRIPTIONS = [
  "This date was verified on an official university source.",
  "The university has not published the official date yet.",
  "We’ll let you know when the university updates it.",
];

test.describe("first launch to Follow", () => {
  test.skip(!databaseAvailable, "Requires the catalogue database (DATABASE_URL).");

  let actor: AuthenticatedActor;
  let program: FollowableProgram;

  test.beforeAll(async () => {
    const followable = await findFollowableProgram("artificial intelligence");
    test.skip(!followable, "The catalogue has no followable program with an intake.");
    program = followable as FollowableProgram;
    actor = await createAuthenticatedActor(`e2e-journey-${randomUUID()}@athenvia.example`);
  });

  test.afterAll(async () => {
    if (actor) {
      await deleteActor(actor);
    }
  });

  test("completes onboarding, search, program detail and Follow in under a minute", async ({
    context,
    page,
  }, testInfo) => {
    // The user-facing budget is asserted below on the measured duration; the
    // harness cap only needs to exceed it under dev-server compile load.
    test.setTimeout(90_000);
    await signInContext(context, actor, E2E_BASE_URL);

    const journeyStart = Date.now();

    // 1. First launch — two-screen onboarding.
    await page.goto("/onboarding");
    await expect(
      page.getByRole("heading", { name: "Keep application dates within reach." }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Get started" }).click();
    await page.getByLabel("Target intake (optional)").selectOption({ index: 1 });
    await page.getByRole("button", { name: "Continue to Athenvia" }).click();
    // First navigation into /home may wait on a dev-server compile.
    await expect(page).toHaveURL(/\/home$/, { timeout: 15_000 });

    // 2. Search the catalogue from the app navigation.
    await page.getByRole("link", { name: "Search" }).click();
    await page.getByLabel("University or program").fill("artificial intelligence");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Programs" })).toBeVisible({
      timeout: 15_000,
    });

    // 3. Open the program detail from its result card.
    await page.getByRole("link", { name: program.name }).first().click();
    await expect(page.getByRole("heading", { name: program.name })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(program.universityName).first()).toBeVisible();

    // Date status and official source are visible and understandable.
    const datesSection = page.locator("section", {
      has: page.getByRole("heading", { name: "Application dates" }),
    });
    await expect(datesSection).toBeVisible();
    const statusTitle = datesSection.locator("[data-status] p").first();
    await expect(statusTitle).toHaveText(new RegExp(DATE_STATUS_TITLES.join("|")));
    await expect(
      datesSection.getByText(new RegExp(DATE_STATUS_DESCRIPTIONS.join("|"))),
    ).toBeVisible();
    await expect(datesSection.getByText("Applications open")).toBeVisible();
    await expect(datesSection.getByText("Next deadline")).toBeVisible();

    const sourceSection = page.locator("section", {
      has: page.getByRole("heading", { name: "Official source" }),
    });
    await expect(
      sourceSection
        .getByRole("link", { name: "Open official university source" })
        .or(sourceSection.getByText("Official source not available yet.")),
    ).toBeVisible();

    // 4. Follow the selected intake.
    await expect(page.getByLabel("Intake to follow")).toBeVisible();
    await page.getByRole("button", { name: "Follow this program" }).click();
    await expect(
      page.getByText("Program followed. Reminder setup is ready for the next step."),
    ).toBeVisible();

    const journeyMs = Date.now() - journeyStart;
    testInfo.annotations.push({
      type: "journey-duration",
      description: `${journeyMs} ms (budget ${JOURNEY_BUDGET_MS} ms)`,
    });
    expect(journeyMs).toBeLessThan(JOURNEY_BUDGET_MS);

    // The Follow is durably stored for this user.
    await expect.poll(() => countWatchlistRows(actor.userId)).toBe(1);
  });

  test("asks an anonymous visitor to sign in before following", async ({ page }) => {
    await page.goto(`/programs/${program.id}`);

    await page.getByRole("button", { name: "Follow this program" }).click();

    await expect(
      page.getByText("Sign in to keep this program in your private watchlist."),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  });
});
