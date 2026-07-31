import {
  classifyDevicePushState,
  decodePublicVapidKey,
  enablePushNotifications,
  isIosDevice,
  PushSubscriptionStoreError,
  syncExistingPushSubscription,
  withTimeout,
} from "./push-permission";

import type {
  DevicePushAvailability,
  EnablePushResult,
  PushCapabilitySnapshot,
  PushSubscriptionLike,
  PushSubscriptionPayload,
  SyncPushResult,
} from "./push-permission";

const SERVICE_WORKER_READY_TIMEOUT_MS = 8_000;

type NavigatorWithStandalone = Navigator & {
  standalone?: boolean;
};

export function isStandaloneDisplay(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (navigator as NavigatorWithStandalone).standalone === true
  );
}

export function pushCapabilitySnapshot(): PushCapabilitySnapshot {
  const hasNotificationApi =
    typeof Notification !== "undefined" && typeof Notification.requestPermission === "function";

  return {
    hasNotificationApi,
    hasPushManager: "PushManager" in window,
    hasServiceWorker: "serviceWorker" in navigator,
    isIos: isIosDevice({
      maxTouchPoints: navigator.maxTouchPoints,
      platform: navigator.platform,
      userAgent: navigator.userAgent,
    }),
    isSecureContext: window.isSecureContext,
    isStandalone: isStandaloneDisplay(),
    permission: hasNotificationApi ? Notification.permission : null,
  };
}

export async function loadPublicVapidKey(): Promise<Uint8Array<ArrayBuffer>> {
  const response = await fetch("/api/push/vapid-public-key", {
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!response.ok) {
    throw new Error("Push configuration is unavailable.");
  }

  const payload: unknown = await response.json();
  if (typeof payload !== "object" || payload === null || !("publicKey" in payload)) {
    throw new Error("Push configuration is unavailable.");
  }

  return decodePublicVapidKey(payload.publicKey);
}

export async function storeSubscription(payload: PushSubscriptionPayload): Promise<void> {
  const response = await fetch("/api/push/subscriptions", {
    body: JSON.stringify(payload),
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (response.status !== 204) {
    let code: string | null = null;
    try {
      const payload: unknown = await response.json();
      if (
        typeof payload === "object" &&
        payload !== null &&
        "error" in payload &&
        typeof payload.error === "object" &&
        payload.error !== null &&
        "code" in payload.error &&
        typeof payload.error.code === "string"
      ) {
        code = payload.error.code;
      }
    } catch {
      // The status remains sufficient to choose safe client recovery.
    }
    throw new PushSubscriptionStoreError(response.status, code);
  }
}

export async function currentPushSubscription(): Promise<PushSubscriptionLike | null> {
  const registration = await navigator.serviceWorker.getRegistration();
  return (await registration?.pushManager.getSubscription()) ?? null;
}

export async function readyPushManager() {
  const registration = await withTimeout(
    navigator.serviceWorker.ready,
    SERVICE_WORKER_READY_TIMEOUT_MS,
    "The service worker did not become ready.",
  );
  return registration.pushManager;
}

/**
 * Single entry point for turning push on with the real browser APIs. It is not
 * `async` on purpose: the native permission prompt must be requested inside the
 * click that called it, so no `await` may run before `enablePushNotifications`.
 */
export function requestPushSubscription(): Promise<EnablePushResult> {
  return enablePushNotifications({
    getPermission: () => Notification.permission,
    getPushManager: readyPushManager,
    loadPublicVapidKey,
    requestPermission: () => Notification.requestPermission(),
    storeSubscription,
  });
}

export function syncPushSubscription(): Promise<SyncPushResult> {
  return syncExistingPushSubscription({
    getExistingSubscription: currentPushSubscription,
    storeSubscription,
  });
}

/**
 * Must run after mount: every input depends on the browser, so calling it while
 * rendering on the server would produce a hydration mismatch.
 */
export async function detectDevicePushState(): Promise<DevicePushAvailability> {
  const snapshot = pushCapabilitySnapshot();
  let hasLocalSubscription = false;

  if (snapshot.hasServiceWorker) {
    try {
      hasLocalSubscription = (await currentPushSubscription()) !== null;
    } catch {
      // An unreadable registration only means we cannot prove a subscription.
    }
  }

  return classifyDevicePushState({ hasLocalSubscription, snapshot });
}
