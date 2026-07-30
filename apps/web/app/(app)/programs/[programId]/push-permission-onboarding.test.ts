import { describe, expect, it, vi } from "vitest";

import {
  classifyPushAvailability,
  decodePublicVapidKey,
  dismissPushOnboarding,
  enablePushNotifications,
  isIosDevice,
  PushSubscriptionStoreError,
  serializePushSubscription,
  shouldConsiderPushOnboarding,
  syncExistingPushSubscription,
  wasPushOnboardingDismissed,
  withTimeout,
} from "../../../../components/push-permission";

import type {
  EnablePushDependencies,
  PushSubscriptionLike,
} from "../../../../components/push-permission";

const endpoint = "https://push.example.test/subscriptions/device-1";
const auth = Buffer.alloc(16, 7).toString("base64url");
const p256dh = Buffer.concat([Buffer.from([0x04]), Buffer.alloc(64, 3)]).toString("base64url");
const publicVapidKey = Buffer.concat([Buffer.from([0x04]), Buffer.alloc(64, 5)]).toString(
  "base64url",
);

function subscription(overrides: Partial<PushSubscriptionLike> = {}): PushSubscriptionLike {
  return {
    endpoint,
    expirationTime: null,
    toJSON: () => ({ keys: { auth, p256dh } }),
    ...overrides,
  };
}

function enableDependencies(
  overrides: Partial<EnablePushDependencies> = {},
): EnablePushDependencies {
  return {
    getPermission: vi.fn((): NotificationPermission => "default"),
    requestPermission: vi.fn(async (): Promise<NotificationPermission> => "granted"),
    loadPublicVapidKey: vi.fn(async () => decodePublicVapidKey(publicVapidKey)),
    getPushManager: vi.fn(async () => ({
      getSubscription: vi.fn(async () => null),
      subscribe: vi.fn(async () => subscription()),
    })),
    storeSubscription: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("push onboarding eligibility", () => {
  it("recognizes iPhone, iPad and desktop-mode iPad user agents", () => {
    expect(
      isIosDevice({
        maxTouchPoints: 0,
        platform: "iPhone",
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
      }),
    ).toBe(true);
    expect(
      isIosDevice({
        maxTouchPoints: 5,
        platform: "MacIntel",
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)",
      }),
    ).toBe(true);
    expect(
      isIosDevice({
        maxTouchPoints: 0,
        platform: "Win32",
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      }),
    ).toBe(false);
  });

  it("explains installation before treating iOS browser APIs as unsupported", () => {
    expect(
      classifyPushAvailability({
        hasNotificationApi: false,
        hasPushManager: false,
        hasServiceWorker: true,
        isIos: true,
        isSecureContext: true,
        isStandalone: false,
        permission: null,
      }),
    ).toBe("install-required");
  });

  it.each([
    {
      expected: "unsupported",
      snapshot: {
        hasNotificationApi: false,
        hasPushManager: true,
        hasServiceWorker: true,
        isIos: false,
        isSecureContext: true,
        isStandalone: false,
        permission: null,
      },
    },
    {
      expected: "denied",
      snapshot: {
        hasNotificationApi: true,
        hasPushManager: true,
        hasServiceWorker: true,
        isIos: true,
        isSecureContext: true,
        isStandalone: true,
        permission: "denied" as const,
      },
    },
    {
      expected: "offer",
      snapshot: {
        hasNotificationApi: true,
        hasPushManager: true,
        hasServiceWorker: true,
        isIos: false,
        isSecureContext: true,
        isStandalone: false,
        permission: "default" as const,
      },
    },
  ])("classifies supported, denied and unsupported states", ({ expected, snapshot }) => {
    expect(classifyPushAvailability(snapshot)).toBe(expected);
  });

  it("normally offers only for a new Follow, with a standalone idempotent recovery", () => {
    expect(shouldConsiderPushOnboarding({ created: true, isStandalone: false })).toBe(true);
    expect(shouldConsiderPushOnboarding({ created: false, isStandalone: false })).toBe(false);
    expect(shouldConsiderPushOnboarding({ created: false, isStandalone: true })).toBe(true);
  });

  it("remembers a dismissal for the current session and tolerates blocked storage", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };

    expect(wasPushOnboardingDismissed(storage)).toBe(false);
    dismissPushOnboarding(storage);
    expect(wasPushOnboardingDismissed(storage)).toBe(true);

    const blockedStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(() => dismissPushOnboarding(blockedStorage)).not.toThrow();
    expect(wasPushOnboardingDismissed(blockedStorage)).toBe(false);
  });
});

describe("push subscription payloads", () => {
  it("decodes a canonical uncompressed VAPID public key", () => {
    expect(decodePublicVapidKey(publicVapidKey)).toEqual(
      Uint8Array.from(Buffer.from(publicVapidKey, "base64url")),
    );
  });

  it.each([
    "",
    "not-base64url!",
    Buffer.alloc(65).toString("base64url"),
    Buffer.alloc(32).toString("base64url"),
  ])("rejects an invalid VAPID public key", (value) => {
    expect(() => decodePublicVapidKey(value)).toThrow("public VAPID key is invalid");
  });

  it("serializes only the fields accepted by the subscription API", () => {
    expect(serializePushSubscription(subscription())).toEqual({
      endpoint,
      expirationTime: null,
      keys: { auth, p256dh },
    });
  });

  it("rejects a browser subscription without both private key handles", () => {
    expect(() =>
      serializePushSubscription(
        subscription({
          toJSON: () => ({ keys: { p256dh } }),
        }),
      ),
    ).toThrow("invalid push subscription");
  });
});

describe("enablePushNotifications", () => {
  it("requests permission before loading VAPID or awaiting the service worker", async () => {
    const calls: string[] = [];
    const dependencies = enableDependencies({
      getPermission: () => "default",
      requestPermission: async () => {
        calls.push("permission");
        return "granted";
      },
      loadPublicVapidKey: async () => {
        calls.push("vapid");
        return decodePublicVapidKey(publicVapidKey);
      },
      getPushManager: async () => {
        calls.push("service-worker");
        return {
          getSubscription: async () => null,
          subscribe: async () => subscription(),
        };
      },
      storeSubscription: async () => {
        calls.push("store");
      },
    });

    await expect(enablePushNotifications(dependencies)).resolves.toBe("enabled");
    expect(calls).toEqual(["permission", "vapid", "service-worker", "store"]);
  });

  it("does no setup when permission is denied or the native prompt is dismissed", async () => {
    const denied = enableDependencies({
      getPermission: () => "denied",
    });
    await expect(enablePushNotifications(denied)).resolves.toBe("denied");
    expect(denied.requestPermission).not.toHaveBeenCalled();
    expect(denied.loadPublicVapidKey).not.toHaveBeenCalled();

    const dismissed = enableDependencies({
      requestPermission: vi.fn(async (): Promise<NotificationPermission> => "default"),
    });
    await expect(enablePushNotifications(dismissed)).resolves.toBe("dismissed");
    expect(dismissed.loadPublicVapidKey).not.toHaveBeenCalled();
  });

  it("skips requestPermission when permission was already granted", async () => {
    const dependencies = enableDependencies({
      getPermission: () => "granted",
    });

    await expect(enablePushNotifications(dependencies)).resolves.toBe("enabled");
    expect(dependencies.requestPermission).not.toHaveBeenCalled();
  });

  it("reuses an existing browser subscription and posts its exact payload", async () => {
    const existingSubscription = subscription({ expirationTime: 1_800_000_000_000 });
    const subscribe = vi.fn(async () => subscription());
    const storeSubscription = vi.fn(async () => undefined);
    const dependencies = enableDependencies({
      getPermission: () => "granted",
      getPushManager: async () => ({
        getSubscription: async () => existingSubscription,
        subscribe,
      }),
      storeSubscription,
    });

    await expect(enablePushNotifications(dependencies)).resolves.toBe("enabled");
    expect(subscribe).not.toHaveBeenCalled();
    expect(storeSubscription).toHaveBeenCalledWith({
      endpoint,
      expirationTime: 1_800_000_000_000,
      keys: { auth, p256dh },
    });
  });

  it("creates a subscription with user-visible VAPID options when none exists", async () => {
    const subscribe = vi.fn(async () => subscription());
    const dependencies = enableDependencies({
      getPushManager: async () => ({
        getSubscription: async () => null,
        subscribe,
      }),
    });

    await expect(enablePushNotifications(dependencies)).resolves.toBe("enabled");
    expect(subscribe).toHaveBeenCalledWith({
      applicationServerKey: decodePublicVapidKey(publicVapidKey),
      userVisibleOnly: true,
    });
  });

  it.each([
    [409, "PUSH_SUBSCRIPTION_CONFLICT"],
    [503, "PUSH_SUBSCRIPTION_UNAVAILABLE"],
  ])(
    "keeps an existing subscription intact for an ambiguous %i store failure",
    async (status, code) => {
      const existingSubscription = subscription();
      const subscribe = vi.fn(async () => subscription());
      const dependencies = enableDependencies({
        getPermission: () => "granted",
        getPushManager: async () => ({
          getSubscription: async () => existingSubscription,
          subscribe,
        }),
        storeSubscription: async () => {
          throw new PushSubscriptionStoreError(status, code);
        },
      });

      await expect(enablePushNotifications(dependencies)).rejects.toMatchObject({
        status,
      });
      expect(subscribe).not.toHaveBeenCalled();
    },
  );
});

describe("syncExistingPushSubscription", () => {
  it("silently resynchronizes an existing local subscription", async () => {
    const storeSubscription = vi.fn(async () => undefined);

    await expect(
      syncExistingPushSubscription({
        getExistingSubscription: async () => subscription(),
        storeSubscription,
      }),
    ).resolves.toBe("synced");
    expect(storeSubscription).toHaveBeenCalledWith({
      endpoint,
      expirationTime: null,
      keys: { auth, p256dh },
    });
  });

  it("does not post when no local subscription exists", async () => {
    const storeSubscription = vi.fn(async () => undefined);

    await expect(
      syncExistingPushSubscription({
        getExistingSubscription: async () => null,
        storeSubscription,
      }),
    ).resolves.toBe("absent");
    expect(storeSubscription).not.toHaveBeenCalled();
  });

  it("keeps a failed synchronization retryable by propagating the error", async () => {
    await expect(
      syncExistingPushSubscription({
        getExistingSubscription: async () => subscription(),
        storeSubscription: async () => {
          throw new Error("API unavailable");
        },
      }),
    ).rejects.toThrow("API unavailable");
  });
});

describe("withTimeout", () => {
  it("rejects a service-worker wait that never settles", async () => {
    vi.useFakeTimers();
    const wait = withTimeout(
      new Promise<never>(() => undefined),
      8_000,
      "Service worker unavailable",
    );
    const expectation = expect(wait).rejects.toThrow("Service worker unavailable");

    await vi.advanceTimersByTimeAsync(8_000);
    await expectation;
    vi.useRealTimers();
  });
});
