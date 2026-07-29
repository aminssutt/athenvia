import { expect, test } from "@playwright/test";

test("opens onboarding on a first CSS standalone launch", async ({ context, page }) => {
  await context.addInitScript(() => {
    const browserMatchMedia = window.matchMedia.bind(window);

    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => {
        const result = browserMatchMedia(query);

        if (query === "(display-mode: standalone)") {
          Object.defineProperty(result, "matches", {
            configurable: true,
            value: true,
          });
        }

        return result;
      },
    });
  });

  await page.goto("/");

  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(
    page.getByRole("heading", { name: "Keep application dates within reach." }),
  ).toBeVisible();
});

test("opens onboarding when iOS navigator.standalone is true", async ({ context, page }) => {
  await context.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "standalone", {
      configurable: true,
      get: () => true,
    });
  });

  await page.goto("/");

  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(
    page.getByRole("heading", { name: "Keep application dates within reach." }),
  ).toBeVisible();
});

test("opens home after standalone onboarding is complete", async ({ context, page }) => {
  await context.addInitScript(() => {
    window.localStorage.setItem(
      "athenvia:onboarding:v1",
      JSON.stringify({ completed: true, targetIntake: null, version: 1 }),
    );

    const browserMatchMedia = window.matchMedia.bind(window);
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => {
        const result = browserMatchMedia(query);
        if (query === "(display-mode: standalone)") {
          Object.defineProperty(result, "matches", {
            configurable: true,
            value: true,
          });
        }
        return result;
      },
    });
  });

  await page.goto("/");

  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole("heading", { name: "Your programs" })).toBeVisible();
});

test("keeps normal mobile Safari on the landing page", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("heading", { name: "Never miss an application date." }),
  ).toBeVisible();
});

test.describe("desktop fallback", () => {
  test.use({
    viewport: { width: 1280, height: 900 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 " +
      "(KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  });

  test("keeps desktop browsers on the landing page", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole("heading", { name: "Never miss an application date." }),
    ).toBeVisible();
  });
});

test("falls back to the landing page when matchMedia is unsupported", async ({ context, page }) => {
  await context.addInitScript(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: undefined,
    });
  });

  await page.goto("/");

  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("heading", { name: "Never miss an application date." }),
  ).toBeVisible();
});
