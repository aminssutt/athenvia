import { expect, test } from "@playwright/test";

/**
 * P5-01 — Landing-to-install pass (#92).
 *
 * Complements landing.spec.ts (guidance copy) and standalone.spec.ts
 * (standalone routing). What can only be proven on a physical iPhone —
 * the native Share > Add to Home Screen sheet and the real standalone
 * launch — is documented in docs/quality/launch-test-passes.md.
 */

function simulateStandaloneDisplay() {
  const browserMatchMedia = window.matchMedia.bind(window);

  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => {
      const result = browserMatchMedia(query);
      if (query === "(display-mode: standalone)") {
        Object.defineProperty(result, "matches", { configurable: true, value: true });
      }
      return result;
    },
  });
}

test.describe("mobile Safari landing", () => {
  test("walks an iPhone visitor through the complete installation guidance", async ({ page }) => {
    await page.goto("/");

    // Hero explains the product before asking for anything.
    await expect(
      page.getByRole("heading", { name: "Never miss an application date." }),
    ).toBeVisible();
    await expect(page.getByText("before applications open or close")).toBeVisible();

    // The call to action leads to the on-page installation steps.
    const installCta = page.getByRole("link", { name: "Install Athenvia" });
    await expect(installCta).toBeVisible();
    await expect(installCta).toHaveAttribute("href", "#install");
    await installCta.click();

    const installSection = page.locator("#install");
    await expect(
      installSection.getByRole("heading", { name: "Keep Athenvia one tap away." }),
    ).toBeVisible();
    await expect(installSection.getByText("No App Store needed.", { exact: false })).toBeVisible();

    // The three Safari installation steps stay in user language.
    const steps = installSection.getByRole("listitem");
    await expect(steps).toHaveCount(3);
    await expect(steps.nth(0)).toContainText("share button");
    await expect(steps.nth(1)).toContainText("Add to Home Screen");
    await expect(steps.nth(2)).toContainText("new icon");
  });

  test("declares an installable standalone app in the web manifest", async ({ request }) => {
    const response = await request.get("/manifest.webmanifest");

    expect(response.ok()).toBe(true);
    const manifest = (await response.json()) as {
      display?: string;
      icons?: Array<{ src: string }>;
      name?: string;
      scope?: string;
      start_url?: string;
    };
    expect(manifest.name).toBe("Athenvia");
    expect(manifest.display).toBe("standalone");
    expect(manifest.scope).toBe("/");
    expect(manifest.start_url).toBe("/");
    expect(manifest.icons?.length ?? 0).toBeGreaterThan(0);

    for (const icon of manifest.icons ?? []) {
      const iconResponse = await request.get(icon.src);
      expect(iconResponse.ok(), `manifest icon ${icon.src} must be served`).toBe(true);
    }
  });
});

test.describe("standalone launch", () => {
  test("opens the app shell and never the marketing landing", async ({ context, page }) => {
    await context.addInitScript(() => {
      window.localStorage.setItem(
        "athenvia:onboarding:v1",
        JSON.stringify({ completed: true, targetIntake: null, version: 1 }),
      );
    });
    await context.addInitScript(simulateStandaloneDisplay);

    await page.goto("/");

    await expect(page).toHaveURL(/\/home$/);
    await expect(page.getByRole("heading", { name: "Your programs" })).toBeVisible();
    // The marketing hero must not leak into the installed app experience.
    await expect(
      page.getByRole("heading", { name: "Never miss an application date." }),
    ).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Install Athenvia" })).toHaveCount(0);
  });

  test("routes a first standalone launch through onboarding before the app", async ({
    context,
    page,
  }) => {
    await context.addInitScript(simulateStandaloneDisplay);

    await page.goto("/");

    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(
      page.getByRole("heading", { name: "Keep application dates within reach." }),
    ).toBeVisible();
  });
});

test.describe("desktop fallback", () => {
  test.use({
    viewport: { width: 1280, height: 900 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 " +
      "(KHTML, like Gecko) Version/18.0 Safari/605.1.15",
    hasTouch: false,
    isMobile: false,
  });

  test("keeps the landing usable and the iPhone guidance readable", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole("heading", { name: "Never miss an application date." }),
    ).toBeVisible();

    // Desktop visitors still get actionable guidance: the product is
    // explicitly presented as an iPhone Home Screen app.
    await expect(page.getByText("Made for your iPhone Home Screen")).toBeVisible();
    await page.getByRole("link", { name: "Install Athenvia" }).click();
    await expect(
      page.locator("#install").getByRole("heading", { name: "Keep Athenvia one tap away." }),
    ).toBeVisible();
    await expect(page.locator("#install")).toContainText("Install it directly from Safari.");

    // No horizontal overflow at a desktop width.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("keeps supporting pages reachable from the desktop landing", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("link", { name: "Privacy" }).click();
    await expect(page).toHaveURL(/\/privacy$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});
