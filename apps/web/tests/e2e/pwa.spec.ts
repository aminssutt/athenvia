import { expect, test } from "@playwright/test";

test("prepares the essential shell and plain-language fallback for offline use", async ({
  page,
}) => {
  await page.goto("/");

  await page.evaluate(async () => {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));

    const registration = await navigator.serviceWorker.register("/sw.js?v=playwright", {
      scope: "/",
      updateViaCache: "none",
    });
    await navigator.serviceWorker.ready;

    if (!registration.active) {
      await new Promise<void>((resolve) => {
        registration.addEventListener("updatefound", () => {
          registration.installing?.addEventListener("statechange", function waitUntilActive() {
            if (this.state === "activated") {
              resolve();
            }
          });
        });
      });
    }
  });

  await page.reload();
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);

  const cachedShell = await page.evaluate(async () => {
    const cacheNames = await caches.keys();
    const shellCacheName = cacheNames.find((name) => name === "athenvia-shell-playwright");
    const shellCache = shellCacheName ? await caches.open(shellCacheName) : null;
    const cachedUrls = shellCache
      ? (await shellCache.keys()).map((request) => new URL(request.url).pathname)
      : [];
    const offlineResponse = await caches.match("/offline");

    return {
      cachedUrls,
      offlineHtml: await offlineResponse?.text(),
    };
  });

  expect(cachedShell.cachedUrls).toEqual(
    expect.arrayContaining(["/", "/home", "/offline", "/manifest.webmanifest"]),
  );
  expect(cachedShell.offlineHtml).toContain("You are offline right now.");
  expect(cachedShell.offlineHtml).toContain("Try again");
});

test("keeps a new deployment waiting until the user accepts it", async ({ page }) => {
  await page.goto("/");

  await page.evaluate(async () => {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
    await navigator.serviceWorker.register("/sw.js?v=first-deployment", {
      scope: "/",
      updateViaCache: "none",
    });
    await navigator.serviceWorker.ready;
  });

  await page.reload();
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);

  const workerVersions = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.register("/sw.js?v=next-deployment", {
      scope: "/",
      updateViaCache: "none",
    });

    await new Promise<void>((resolve) => {
      if (registration.waiting) {
        resolve();
        return;
      }

      const installingWorker = registration.installing;
      if (!installingWorker) {
        resolve();
        return;
      }

      installingWorker.addEventListener("statechange", () => {
        if (installingWorker.state === "installed") {
          resolve();
        }
      });
    });

    return {
      active: registration.active?.scriptURL,
      waiting: registration.waiting?.scriptURL,
    };
  });

  expect(workerVersions.active).toContain("v=first-deployment");
  expect(workerVersions.waiting).toContain("v=next-deployment");
});
