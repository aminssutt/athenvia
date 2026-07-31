export const FOLLOW_SUCCEEDED_EVENT = "athenvia:follow-succeeded";
export const PUSH_ONBOARDING_DISMISSED_KEY = "athenvia:push-onboarding-dismissed:v1";

export type FollowSucceededDetail = {
  created: boolean;
  intakeId: string;
  programId: string;
  watchlistId: string;
};

export type PushAvailability = "denied" | "install-required" | "offer" | "unsupported";

/**
 * Adds the one state a capability snapshot alone cannot express: this browser
 * already holds a push subscription, so nothing is left to turn on here.
 */
export type DevicePushAvailability = "subscribed" | PushAvailability;

export type PushCapabilitySnapshot = {
  hasNotificationApi: boolean;
  hasPushManager: boolean;
  hasServiceWorker: boolean;
  isIos: boolean;
  isSecureContext: boolean;
  isStandalone: boolean;
  permission: NotificationPermission | null;
};

export type PushSubscriptionPayload = {
  endpoint: string;
  expirationTime: number | null;
  keys: {
    auth: string;
    p256dh: string;
  };
};

export type PushSubscriptionLike = {
  endpoint: string;
  expirationTime: number | null;
  toJSON(): {
    keys?: {
      auth?: string;
      p256dh?: string;
    };
  };
};

export type PushManagerLike = {
  getSubscription(): Promise<PushSubscriptionLike | null>;
  subscribe(options: {
    applicationServerKey: Uint8Array<ArrayBuffer>;
    userVisibleOnly: true;
  }): Promise<PushSubscriptionLike>;
};

export type EnablePushDependencies = {
  getPermission(): NotificationPermission;
  getPushManager(): Promise<PushManagerLike>;
  loadPublicVapidKey(): Promise<Uint8Array<ArrayBuffer>>;
  requestPermission(): Promise<NotificationPermission>;
  storeSubscription(payload: PushSubscriptionPayload): Promise<void>;
};

export type SyncPushDependencies = {
  getExistingSubscription(): Promise<PushSubscriptionLike | null>;
  storeSubscription(payload: PushSubscriptionPayload): Promise<void>;
};

export type EnablePushResult = "denied" | "dismissed" | "enabled";
export type SyncPushResult = "absent" | "synced";

type PushOnboardingStorage = Pick<Storage, "getItem" | "setItem">;

export class PushSubscriptionStoreError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
  ) {
    super(`The push subscription could not be saved (${status}).`);
    this.name = "PushSubscriptionStoreError";
  }
}

export function wasPushOnboardingDismissed(storage: PushOnboardingStorage): boolean {
  try {
    return storage.getItem(PUSH_ONBOARDING_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function dismissPushOnboarding(storage: PushOnboardingStorage): void {
  try {
    storage.setItem(PUSH_ONBOARDING_DISMISSED_KEY, "1");
  } catch {
    // The browser may disable storage in a strict privacy mode.
  }
}

export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMilliseconds: number,
  message: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => {
      reject(new Error(message));
    }, timeoutMilliseconds);

    void promise.then(
      (value) => {
        globalThis.clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        globalThis.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

export function isIosDevice({
  maxTouchPoints,
  platform,
  userAgent,
}: {
  maxTouchPoints: number;
  platform: string;
  userAgent: string;
}): boolean {
  return /iPad|iPhone|iPod/i.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1);
}

export function classifyPushAvailability(snapshot: PushCapabilitySnapshot): PushAvailability {
  if (snapshot.isIos && !snapshot.isStandalone) {
    return "install-required";
  }

  if (
    !snapshot.isSecureContext ||
    !snapshot.hasNotificationApi ||
    !snapshot.hasServiceWorker ||
    !snapshot.hasPushManager ||
    snapshot.permission === null
  ) {
    return "unsupported";
  }

  return snapshot.permission === "denied" ? "denied" : "offer";
}

export function classifyDevicePushState({
  hasLocalSubscription,
  snapshot,
}: {
  hasLocalSubscription: boolean;
  snapshot: PushCapabilitySnapshot;
}): DevicePushAvailability {
  const availability = classifyPushAvailability(snapshot);

  // A stale registration can survive a revoked permission, so both signals must
  // agree before we tell the owner this device is already covered.
  return availability === "offer" && snapshot.permission === "granted" && hasLocalSubscription
    ? "subscribed"
    : availability;
}

export function shouldConsiderPushOnboarding({
  created,
  isStandalone,
}: {
  created: boolean;
  isStandalone: boolean;
}): boolean {
  return created || isStandalone;
}

function base64UrlFromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

export function decodePublicVapidKey(value: unknown): Uint8Array<ArrayBuffer> {
  if (typeof value !== "string" || value.length !== 87 || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new Error("The public VAPID key is invalid.");
  }

  const padded = `${value}${"=".repeat((4 - (value.length % 4)) % 4)}`
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new Error("The public VAPID key is invalid.");
  }

  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (bytes.length !== 65 || bytes[0] !== 0x04 || base64UrlFromBytes(bytes) !== value) {
    throw new Error("The public VAPID key is invalid.");
  }

  return bytes;
}

export function serializePushSubscription(
  subscription: PushSubscriptionLike,
): PushSubscriptionPayload {
  const serialized = subscription.toJSON();
  const auth = serialized.keys?.auth;
  const p256dh = serialized.keys?.p256dh;

  if (
    typeof subscription.endpoint !== "string" ||
    subscription.endpoint.length === 0 ||
    (subscription.expirationTime !== null &&
      (!Number.isFinite(subscription.expirationTime) || subscription.expirationTime < 0)) ||
    typeof auth !== "string" ||
    auth.length === 0 ||
    typeof p256dh !== "string" ||
    p256dh.length === 0
  ) {
    throw new Error("The browser returned an invalid push subscription.");
  }

  return {
    endpoint: subscription.endpoint,
    expirationTime: subscription.expirationTime,
    keys: { auth, p256dh },
  };
}

export async function enablePushNotifications(
  dependencies: EnablePushDependencies,
): Promise<EnablePushResult> {
  let permission = dependencies.getPermission();

  if (permission === "default") {
    // This call must stay before VAPID loading or any service-worker await.
    // iOS requires the native prompt to follow direct user interaction.
    permission = await dependencies.requestPermission();
  }

  if (permission === "denied") {
    return "denied";
  }
  if (permission !== "granted") {
    return "dismissed";
  }

  const publicVapidKey = await dependencies.loadPublicVapidKey();
  const pushManager = await dependencies.getPushManager();
  const existingSubscription = await pushManager.getSubscription();
  const subscription =
    existingSubscription ??
    (await pushManager.subscribe({
      applicationServerKey: publicVapidKey,
      userVisibleOnly: true,
    }));

  await dependencies.storeSubscription(serializePushSubscription(subscription));
  return "enabled";
}

export async function syncExistingPushSubscription(
  dependencies: SyncPushDependencies,
): Promise<SyncPushResult> {
  const subscription = await dependencies.getExistingSubscription();
  if (!subscription) {
    return "absent";
  }

  await dependencies.storeSubscription(serializePushSubscription(subscription));
  return "synced";
}
