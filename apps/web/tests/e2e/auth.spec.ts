import { expect, test } from "@playwright/test";

test("keeps anonymous device state and shows a generic magic-link response", async ({ page }) => {
  await page.route("**/api/auth/**", async (route) => {
    const request = route.request();

    if (request.url().endsWith("/providers")) {
      await route.fulfill({
        contentType: "application/json",
        json: {
          email: {
            id: "email",
            name: "Email",
            signinUrl: "/api/auth/signin/email",
            type: "email",
          },
        },
      });
      return;
    }

    if (request.url().endsWith("/csrf")) {
      await route.fulfill({
        contentType: "application/json",
        json: { csrfToken: "test-csrf-token" },
      });
      return;
    }

    await route.fulfill({
      contentType: "application/json",
      json: { url: "http://127.0.0.1:3100/sign-in/check-email" },
    });
  });

  await page.goto("/home");
  await page.evaluate(() => {
    localStorage.setItem(
      "athenvia:onboarding",
      JSON.stringify({ targetPeriod: "2027", completed: true }),
    );
  });

  await page.getByRole("link", { name: "Sign in to sync" }).click();
  await page.getByLabel("Email address").fill("student@example.com");
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();

  await expect(page).toHaveURL(/\/sign-in\/check-email$/);
  await expect(page.getByRole("heading", { name: "Check your inbox." })).toBeVisible();
  await expect(page.getByText("student@example.com")).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("athenvia:onboarding")))
    .toBe(JSON.stringify({ targetPeriod: "2027", completed: true }));
});
