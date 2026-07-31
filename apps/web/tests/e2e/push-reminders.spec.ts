import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import type { Page } from "@playwright/test";

import {
  createAuthenticatedActor,
  deleteActor,
  findFollowableProgram,
  findPushSubscriptionEndpoints,
  signInContext,
  type AuthenticatedActor,
} from "./helpers/db";
import { databaseAvailable, E2E_BASE_URL, E2E_VAPID_PUBLIC_KEY } from "./helpers/test-env";

/**
 * P5-03 — Push permission and reminder pass (#94).
 *
 * Reminder single-delivery is guaranteed by the worker suite (dedupeKey is
 * unique in notification_deliveries; see apps/worker/src/notification-delivery.test.ts
 * "allows two concurrent jobs to claim once and send once"). These journeys
 * prove the browser side: no prompt without user action, the Follow panel is
 * the only entry point, and an accepted prompt lands a stored subscription.
 * Real push receipt on a device stays a physical-iPhone task.
 */

// A valid uncompressed P-256 point (device browser key) for the fake
// PushManager; the API validates the curve point server-side.
const FAKE_DEVICE_P256DH =
  "BGpOo2s3Cyxgadlf6tMvBXyvDa9Ln7Y8G0nGkn_0cuZBvdXTpUkjOg7Lpmgb7BzfwnaE3kG_jbuJb5qNa2qiYnQ";
const FAKE_DEVICE_AUTH = "AVMmu_evzP1KLnwrnsEEYQ";

function instrumentNotificationPrompts() {
  const state = { permission: "default" as NotificationPermission, prompts: 0 };

  class InstrumentedNotification {
    static get permission(): NotificationPermission {
      return state.permission;
    }

    static requestPermission(): Promise<NotificationPermission> {
      state.prompts += 1;
      state.permission = "granted";
      return Promise.resolve(state.permission);
    }
  }

  Object.defineProperty(window, "Notification", {
    configurable: true,
    value: InstrumentedNotification,
  });
  Object.defineProperty(window, "__athenviaNotificationPrompts", {
    configurable: true,
    get: () => state.prompts,
  });
}

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
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
}

type FakePushEnvironment = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

function installFakePushManager(environment: FakePushEnvironment) {
  Object.defineProperty(window, "PushManager", {
    configurable: true,
    value: function PushManager() {
      // Capability marker only; instances are never constructed by the app.
    },
  });

  function toBase64Url(bytes: Uint8Array): string {
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
  }

  const fakeSubscription = {
    endpoint: environment.endpoint,
    expirationTime: null,
    toJSON: () => ({
      keys: { auth: environment.auth, p256dh: environment.p256dh },
    }),
  };

  const fakePushManager = {
    getSubscription: () => Promise.resolve(null),
    subscribe: (options: { applicationServerKey: Uint8Array }) => {
      Object.defineProperty(window, "__athenviaApplicationServerKey", {
        configurable: true,
        value: toBase64Url(options.applicationServerKey),
      });
      return Promise.resolve(fakeSubscription);
    },
  };

  Object.defineProperty(ServiceWorkerRegistration.prototype, "pushManager", {
    configurable: true,
    get: () => fakePushManager,
  });
}

async function promptCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const counter = (window as { __athenviaNotificationPrompts?: number })
      .__athenviaNotificationPrompts;
    return counter ?? 0;
  });
}

test("never requests notification permission while browsing", async ({ context, page }) => {
  await context.addInitScript(instrumentNotificationPrompts);

  for (const path of ["/", "/onboarding", "/home", "/search"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    expect(await promptCount(page), `no permission prompt after loading ${path}`).toBe(0);
    expect(
      await page.evaluate(() => Notification.permission),
      `permission untouched after loading ${path}`,
    ).toBe("default");
  }
});

test("verifies the notification click handler only opens program deep links", async ({ page }) => {
  await page.goto("/");

  const verdicts = await page.evaluate(async () => {
    const scriptResponse = await fetch("/sw-notifications.js");
    const script = await scriptResponse.text();
    // The file is written for the worker global scope; in a window, `self`
    // is the window so the exposed navigation guard lands on window.
    new Function(script)();
    const guard = (
      window as unknown as {
        __athenviaNotificationNavigation: {
          safeProgramDeepLink: (value: unknown) => string | null;
        };
      }
    ).__athenviaNotificationNavigation;

    const programPath = "/programs/0b7f9d64-24ab-4c1a-9d5f-4a4de3f5a111";
    return {
      valid: guard.safeProgramDeepLink(programPath),
      absoluteUrl: guard.safeProgramDeepLink(`https://evil.example${programPath}`),
      otherRoute: guard.safeProgramDeepLink("/settings"),
      withQuery: guard.safeProgramDeepLink(`${programPath}?next=https://evil.example`),
      withBackslash: guard.safeProgramDeepLink("\\programs\\0b7f9d64"),
      nonUuid: guard.safeProgramDeepLink("/programs/not-a-uuid"),
    };
  });

  expect(verdicts.valid).toBe("/programs/0b7f9d64-24ab-4c1a-9d5f-4a4de3f5a111");
  expect(verdicts.absoluteUrl).toBeNull();
  expect(verdicts.otherRoute).toBeNull();
  expect(verdicts.withQuery).toBeNull();
  expect(verdicts.withBackslash).toBeNull();
  expect(verdicts.nonUuid).toBeNull();
});

test.describe("after a Follow", () => {
  test.skip(!databaseAvailable, "Requires the catalogue database (DATABASE_URL).");

  let actor: AuthenticatedActor;

  test.beforeEach(async () => {
    actor = await createAuthenticatedActor(`e2e-push-${randomUUID()}@athenvia.example`);
  });

  test.afterEach(async () => {
    await deleteActor(actor);
  });

  test("guides iPhone Safari (not installed) to install before enabling reminders", async ({
    context,
    page,
  }) => {
    const program = await findFollowableProgram("");
    test.skip(!program, "The catalogue has no followable program with an intake.");

    await signInContext(context, actor, E2E_BASE_URL);
    await page.goto(`/programs/${program!.id}`);

    await page.getByRole("button", { name: "Follow this program" }).click();
    await expect(
      page.getByText("Program followed. Reminder setup is ready for the next step."),
    ).toBeVisible();

    // iOS in a browser tab cannot subscribe; the panel says so in user terms.
    await expect(
      page.getByRole("heading", { name: "Install Athenvia for reminders" }),
    ).toBeVisible();
    await expect(page.getByText("Add to Home Screen").last()).toBeVisible();
  });

  test("registers the push subscription only after the user turns reminders on", async ({
    context,
    page,
  }) => {
    const program = await findFollowableProgram("");
    test.skip(!program, "The catalogue has no followable program with an intake.");

    const endpoint = `https://push.e2e.athenvia.example/registration/${randomUUID()}`;

    await context.addInitScript(instrumentNotificationPrompts);
    await context.addInitScript(simulateStandaloneDisplay);
    await context.addInitScript(installFakePushManager, {
      auth: FAKE_DEVICE_AUTH,
      endpoint,
      p256dh: FAKE_DEVICE_P256DH,
    });
    await signInContext(context, actor, E2E_BASE_URL);

    await page.goto(`/programs/${program!.id}`);

    // The push flow needs a ready service worker; production registers it on
    // load, the dev server under test registers it here (see pwa.spec.ts).
    await page.evaluate(async () => {
      await navigator.serviceWorker.register("/sw.js?v=push-e2e", {
        scope: "/",
        updateViaCache: "none",
      });
      await navigator.serviceWorker.ready;
    });

    await page.getByRole("button", { name: "Follow this program" }).click();
    await expect(
      page.getByRole("heading", { name: "Get reminders for this program" }),
    ).toBeVisible();

    // The offer alone must not prompt: permission stays untouched until the
    // explicit "Turn on reminders" action.
    expect(await promptCount(page)).toBe(0);
    expect(await findPushSubscriptionEndpoints(actor.userId)).toEqual([]);

    await page.getByRole("button", { name: "Turn on reminders" }).click();
    await expect(page.getByRole("heading", { name: "Reminders are on" })).toBeVisible();

    expect(await promptCount(page)).toBe(1);

    // The subscription used the server VAPID key and is now stored for the
    // worker to deliver reminders to this device.
    expect(
      await page.evaluate(
        () =>
          (window as { __athenviaApplicationServerKey?: string }).__athenviaApplicationServerKey,
      ),
    ).toBe(E2E_VAPID_PUBLIC_KEY);
    await expect.poll(() => findPushSubscriptionEndpoints(actor.userId)).toEqual([endpoint]);
  });
});
