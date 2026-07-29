import { expect, test } from "@playwright/test";

const STORAGE_KEY = "athenvia:onboarding:v1";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate((key) => window.localStorage.removeItem(key), STORAGE_KEY);
});

test("completes the two-screen flow with an optional target intake", async ({ page }) => {
  await page.goto("/onboarding");

  await expect(
    page.getByRole("heading", { name: "Keep application dates within reach." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Get started" }).click();

  const intakeHeading = page.getByRole("heading", { name: "When do you plan to start?" });
  await expect(intakeHeading).toBeFocused();
  await page.getByLabel("Target intake (optional)").selectOption("fall-2027");
  await page.getByRole("button", { name: "Continue to Athenvia" }).click();

  await expect(page).toHaveURL(/\/home$/);
  await expect
    .poll(() => page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY))
    .toBe(JSON.stringify({ completed: true, targetIntake: "fall-2027", version: 1 }));
});

test("can skip without an intake and does not repeat after completion", async ({ page }) => {
  await page.goto("/onboarding");
  await page.getByRole("button", { name: "Skip for now" }).click();

  await expect(page).toHaveURL(/\/home$/);
  await expect
    .poll(() => page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY))
    .toBe(JSON.stringify({ completed: true, targetIntake: null, version: 1 }));

  await page.goto("/onboarding");
  await expect(page).toHaveURL(/\/home$/);
});
