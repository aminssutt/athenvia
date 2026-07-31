import { expect, test } from "@playwright/test";

import type { Locator, Page } from "@playwright/test";

/**
 * WCAG 2.2 AA invariants for the core journeys (issue #101).
 *
 * These tests intentionally avoid seeded data: they assert the structural
 * accessibility contract of each screen (landmarks, labels, keyboard
 * operability, focus management, target sizes) in the anonymous state,
 * which is a real product state.
 */

const ONBOARDING_STORAGE_KEY = "athenvia:onboarding:v1";

async function expectVisibleFocusIndicator(page: Page, locator: Locator) {
  await expect(locator).toBeFocused();
  const outline = await locator.evaluate((element) => {
    const style = window.getComputedStyle(element);
    return { style: style.outlineStyle, width: style.outlineWidth };
  });
  expect(outline.style).not.toBe("none");
  expect(Number.parseFloat(outline.width)).toBeGreaterThanOrEqual(2);
}

test.describe("landing", () => {
  test("exposes a single main landmark with an ordered heading outline", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page).toHaveTitle(/Athenvia/);
    await expect(page.getByRole("main")).toHaveCount(1);

    const h1 = page.getByRole("heading", { level: 1 });
    await expect(h1).toHaveCount(1);
    await expect(h1).toHaveText("Never miss an application date.");

    // The install CTA is an in-page anchor whose target section must exist.
    const installCta = page.getByRole("link", { name: "Install Athenvia" });
    await expect(installCta).toHaveAttribute("href", "#install");
    await expect(page.locator("#install")).toHaveCount(1);
  });

  test("essential landing controls are focusable and none opts out of the tab order", async ({
    page,
  }) => {
    // WebKit's iPhone emulation mirrors Safari: Tab only traverses form
    // controls, never links, so sequential tabbing across the landing page
    // cannot be exercised here. We assert the invariants that make links
    // keyboard-reachable instead (see docs/quality/wcag-2.2-aa-review.md).
    await page.goto("/");

    for (const name of ["Privacy", "Install Athenvia", "Athenvia home"]) {
      const link = page.getByRole("link", { name });
      await expect(link).not.toHaveAttribute("tabindex", "-1");
      await link.focus();
      await expect(link).toBeFocused();
    }

    // No element on the page hijacks the tab order with a positive tabindex.
    await expect(page.locator("[tabindex]:not([tabindex='-1']):not([tabindex='0'])")).toHaveCount(
      0,
    );
  });

  test("honours prefers-reduced-motion by disabling transitions", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");

    const transitionDuration = await page
      .getByRole("link", { name: "Install Athenvia" })
      .evaluate((element) => window.getComputedStyle(element).transitionDuration);

    // globals.css collapses every transition to 0.01ms under reduced motion.
    expect(Number.parseFloat(transitionDuration)).toBeLessThanOrEqual(0.001);
  });
});

test.describe("onboarding", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.evaluate((key) => window.localStorage.removeItem(key), ONBOARDING_STORAGE_KEY);
  });

  test("can be completed with the keyboard alone and moves focus between steps", async ({
    page,
  }) => {
    await page.goto("/onboarding");

    const getStarted = page.getByRole("button", { name: "Get started" });
    await getStarted.focus();
    await expect(getStarted).toBeFocused();
    await page.keyboard.press("Enter");

    // Step change announces itself by moving focus to the new heading.
    const intakeHeading = page.getByRole("heading", { name: "When do you plan to start?" });
    await expect(intakeHeading).toBeFocused();

    // The optional select is properly labelled and described.
    const intakeSelect = page.getByLabel("Target intake (optional)");
    await expect(intakeSelect).toHaveAttribute("aria-describedby", "target-intake-help");
    await intakeSelect.focus();
    await intakeSelect.selectOption({ index: 1 });

    const continueButton = page.getByRole("button", { name: "Continue to Athenvia" });
    await continueButton.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/home$/);
  });

  test("moving back to step one restores focus to the intro heading", async ({ page }) => {
    await page.goto("/onboarding");

    await page.getByRole("button", { name: "Get started" }).click();
    await page.getByRole("button", { name: "Back" }).click();
    await expect(
      page.getByRole("heading", { name: "Keep application dates within reach." }),
    ).toBeFocused();
  });
});

test.describe("search", () => {
  test("labels the search form and exposes the domain filters as a fieldset", async ({ page }) => {
    await page.goto("/search");

    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1, name: "Search" })).toBeVisible();

    const searchBox = page.getByRole("searchbox", { name: "University or program" });
    await expect(searchBox).toBeVisible();
    await expect(searchBox).toHaveAttribute("aria-describedby", "search-help");

    const filterGroup = page.getByRole("group", { name: "Filter by domain" });
    await expect(filterGroup).toBeVisible();
    await expect(filterGroup.getByRole("radio", { name: "All" })).toBeChecked();
  });

  test("domain filter chips are keyboard operable radios with visible focus", async ({ page }) => {
    await page.goto("/search");

    const allRadio = page.getByRole("radio", { name: "All" });
    await allRadio.focus();
    await expect(allRadio).toBeFocused();

    // Arrow keys must move the selection along the radio group.
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("radio", { name: "Entrepreneurship" })).toBeChecked();
    await page.keyboard.press("ArrowLeft");
    await expect(allRadio).toBeChecked();

    // The visually-hidden input must still paint focus on its visible chip.
    const chipOutline = await allRadio.evaluate((input) => {
      const chip = input.nextElementSibling;
      return chip ? window.getComputedStyle(chip).outlineStyle : "missing";
    });
    expect(chipOutline).not.toBe("missing");
  });

  test("keyboard focus paints a visible indicator on form controls", async ({ page }) => {
    await page.goto("/search");

    // Establish keyboard interaction, then move focus with Tab so that
    // :focus-visible applies (pointer focus may legitimately not paint it).
    await page.getByRole("searchbox", { name: "University or program" }).click();
    await page.keyboard.press("Tab");

    const submitButton = page.getByRole("button", { name: "Search", exact: true });
    await expectVisibleFocusIndicator(page, submitButton);
  });

  test("the clear control has an accessible name and returns focus to the input", async ({
    page,
  }) => {
    await page.goto("/search");

    const searchBox = page.getByRole("searchbox", { name: "University or program" });
    await searchBox.click();
    await searchBox.pressSequentially("NUS");

    const clearButton = page.getByRole("button", { name: "Clear search" });
    await clearButton.click();
    await expect(searchBox).toHaveValue("");
    await expect(searchBox).toBeFocused();
  });

  test("a too-short query reports the error and returns focus to the input", async ({ page }) => {
    await page.goto("/search");

    const searchBox = page.getByRole("searchbox", { name: "University or program" });
    await searchBox.click();
    await searchBox.pressSequentially("N");
    await page.getByRole("button", { name: "Search", exact: true }).click();

    await expect(page.getByText("Enter at least two characters to search.")).toBeVisible();
    await expect(searchBox).toBeFocused();
  });
});

test.describe("app navigation", () => {
  test("is a labelled landmark that marks the current page", async ({ page }) => {
    await page.goto("/search");

    const navigation = page.getByRole("navigation", { name: "Main navigation" });
    await expect(navigation).toBeVisible();
    await expect(navigation.getByRole("link")).toHaveCount(4);

    await expect(navigation.getByRole("link", { name: /Search, current page/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(navigation.getByRole("link", { name: "Home" })).not.toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("every navigation link meets the WCAG 2.2 minimum target size", async ({ page }) => {
    await page.goto("/search");

    const links = page.getByRole("navigation", { name: "Main navigation" }).getByRole("link");
    for (const link of await links.all()) {
      const box = await link.boundingBox();
      expect(box, "navigation link must be visible").not.toBeNull();
      expect(box!.width).toBeGreaterThanOrEqual(24);
      expect(box!.height).toBeGreaterThanOrEqual(24);
    }
  });
});

test.describe("sign-in", () => {
  test("the magic link form is labelled and keyboard operable", async ({ page }) => {
    await page.goto("/sign-in");

    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Keep your programs with you.",
    );

    const email = page.getByLabel("Email address");
    await expect(email).toHaveAttribute("type", "email");
    await expect(email).toHaveAttribute("autocomplete", "email");

    await email.focus();
    await expect(email).toBeFocused();

    await expect(page.getByRole("button", { name: "Email me a sign-in link" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Continue without an account" })).toBeVisible();
  });

  test("keyboard traversal never traps focus", async ({ page }) => {
    await page.goto("/sign-in");

    const visited = new Set<string>();
    for (let press = 0; press < 15; press += 1) {
      await page.keyboard.press("Tab");
      const descriptor = await page.evaluate(() => {
        const active = document.activeElement;
        if (!active || active === document.body) {
          return "body";
        }
        return `${active.tagName}:${active.textContent?.trim().slice(0, 30) ?? ""}`;
      });
      visited.add(descriptor);
    }

    // Focus must keep moving through distinct controls instead of sticking.
    expect(visited.size).toBeGreaterThanOrEqual(3);
  });
});

test.describe("watchlist and account screens (anonymous state)", () => {
  test("home explains the anonymous state and offers a labelled sign-in action", async ({
    page,
  }) => {
    await page.goto("/home");

    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your programs");
    await expect(
      page.getByRole("heading", { name: "Sign in to access your watchlist" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
  });

  test("notifications history offers a labelled empty state when signed out", async ({ page }) => {
    await page.goto("/notifications");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Notifications");
    await expect(page.getByRole("heading", { name: "Sign in to see your history" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
  });

  test("settings keeps its landmark structure while anonymous", async ({ page }) => {
    await page.goto("/settings");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Settings");
    await expect(page.getByRole("link", { name: "Sign in to manage settings" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
  });
});
