import { expect, test } from "@playwright/test";

test("explains the product and the iPhone installation journey", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Never miss an application date." }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Install Athenvia" })).toBeVisible();
  await expect(page.getByText("Tap the Safari share button.")).toBeVisible();
  await expect(page.getByText("Add to Home Screen")).toBeVisible();
  await expect(page.getByRole("link", { name: "Privacy" })).toBeVisible();
});
