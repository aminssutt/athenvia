// Covers the browser adapters shared by the Settings control and the
// post-Follow onboarding panel. It lives here because the Vitest project only
// collects test files under app/ and lib/.
import { afterEach, describe, expect, it, vi } from "vitest";

import { detectDevicePushState, requestPushSubscription } from "@/components/push-enable";

import type { PushSubscriptionLike } from "@/components/push-permission";

const endpoint = "https://push.example.test/subscriptions/device-1";
const auth = Buffer.alloc(16, 7).toString("base64url");
const p256dh = Buffer.concat([Buffer.from([0x04]), Buffer.alloc(64, 3)]).toString("base64url");
const publicVapidKey = Buffer.concat([Buffer.from([0x04]), Buffer.alloc(64, 5)]).toString(
  "base64url",
);

function subscription(): PushSubscriptionLike {
  return {
    endpoint,
    expirationTime: null,
    toJSON: () => ({ keys: { auth, p256dh } }),
  };
}

function stubBrowser({
  calls = [],
  existingSubscription = null,
  getRegistration = async () => ({
    pushManager: { getSubscription: async () => existingSubscription },
  }),
  permission = "default",
  serviceWorker = true,
  userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
}: {
  calls?: string[];
  existingSubscription?: PushSubscriptionLike | null;
  getRegistration?: () => Promise<unknown>;
  permission?: NotificationPermission;
  serviceWorker?: boolean;
  userAgent?: string;
} = {}) {
  const requestPermission = vi.fn(async () => {
    calls.push("permission");
    return permission === "default" ? "granted" : permission;
  });

  vi.stubGlobal("window", {
    PushManager: class {},
    isSecureContext: true,
    matchMedia: () => ({ matches: false }),
  });
  vi.stubGlobal("navigator", {
    maxTouchPoints: 0,
    platform: "Win32",
    userAgent,
    ...(serviceWorker
      ? {
          serviceWorker: {
            getRegistration,
            ready: Promise.resolve({
              pushManager: {
                getSubscription: async () => existingSubscription,
                subscribe: async () => {
                  calls.push("subscribe");
                  return subscription();
                },
              },
            }),
          },
        }
      : {}),
  });
  vi.stubGlobal("Notification", { permission, requestPermission });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      if (String(input).includes("vapid-public-key")) {
        calls.push("vapid");
        return { json: async () => ({ publicKey: publicVapidKey }), ok: true };
      }

      calls.push("store");
      return { status: 204 };
    }),
  );

  return { calls, requestPermission };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("detectDevicePushState", () => {
  it("reads capability and registration from the browser it runs in", async () => {
    stubBrowser({ existingSubscription: subscription(), permission: "granted" });

    await expect(detectDevicePushState()).resolves.toBe("subscribed");
  });

  it("offers activation when this browser holds no subscription yet", async () => {
    stubBrowser({ permission: "default" });

    await expect(detectDevicePushState()).resolves.toBe("offer");
  });

  it("reports a blocked permission instead of an activation offer", async () => {
    stubBrowser({ existingSubscription: subscription(), permission: "denied" });

    await expect(detectDevicePushState()).resolves.toBe("denied");
  });

  it("asks iOS owners to install before reading any registration", async () => {
    const getRegistration = vi.fn(async () => null);
    stubBrowser({
      getRegistration,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
    });

    await expect(detectDevicePushState()).resolves.toBe("install-required");
  });

  it("stays usable when the service worker is missing or unreadable", async () => {
    stubBrowser({ serviceWorker: false });
    await expect(detectDevicePushState()).resolves.toBe("unsupported");

    stubBrowser({
      getRegistration: async () => {
        throw new Error("registration unavailable");
      },
      permission: "granted",
    });
    await expect(detectDevicePushState()).resolves.toBe("offer");
  });
});

describe("requestPushSubscription", () => {
  it("prompts for permission before any network or service-worker work", async () => {
    const { calls } = stubBrowser();

    await expect(requestPushSubscription()).resolves.toBe("enabled");
    expect(calls).toEqual(["permission", "vapid", "subscribe", "store"]);
  });

  it("reports a refused prompt without contacting the API", async () => {
    const { calls, requestPermission } = stubBrowser({ permission: "denied" });

    await expect(requestPushSubscription()).resolves.toBe("denied");
    expect(requestPermission).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });
});
