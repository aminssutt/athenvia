"use client";

import { useEffect, useRef, useState } from "react";

import {
  classifyPushAvailability,
  decodePublicVapidKey,
  dismissPushOnboarding,
  enablePushNotifications,
  FOLLOW_SUCCEEDED_EVENT,
  isIosDevice,
  PushSubscriptionStoreError,
  shouldConsiderPushOnboarding,
  syncExistingPushSubscription,
  wasPushOnboardingDismissed,
  withTimeout,
} from "./push-permission";
import styles from "./push-permission-onboarding.module.css";

import type {
  FollowSucceededDetail,
  PushCapabilitySnapshot,
  PushSubscriptionLike,
  PushSubscriptionPayload,
} from "./push-permission";
import type { RefObject } from "react";

const SERVICE_WORKER_READY_TIMEOUT_MS = 8_000;

type PanelState =
  | { kind: "closed" }
  | { kind: "denied" }
  | { kind: "enabled" }
  | { kind: "enabling" }
  | { kind: "error" }
  | { kind: "install-required" }
  | { kind: "offer" }
  | { kind: "permission-dismissed" }
  | { kind: "unsupported" };

type PushPermissionOnboardingProps = {
  returnFocusRef: RefObject<HTMLElement | null>;
};

type NavigatorWithStandalone = Navigator & {
  standalone?: boolean;
};

function isStandaloneDisplay(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (navigator as NavigatorWithStandalone).standalone === true
  );
}

function pushCapabilitySnapshot(): PushCapabilitySnapshot {
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

function followSucceededDetail(event: Event): FollowSucceededDetail | null {
  if (!(event instanceof CustomEvent) || typeof event.detail !== "object" || !event.detail) {
    return null;
  }

  const detail = event.detail as Partial<FollowSucceededDetail>;
  return typeof detail.created === "boolean" &&
    typeof detail.intakeId === "string" &&
    typeof detail.programId === "string" &&
    typeof detail.watchlistId === "string"
    ? (detail as FollowSucceededDetail)
    : null;
}

async function loadPublicVapidKey(): Promise<Uint8Array<ArrayBuffer>> {
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

async function storeSubscription(payload: PushSubscriptionPayload): Promise<void> {
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

async function currentPushSubscription(): Promise<PushSubscriptionLike | null> {
  const registration = await navigator.serviceWorker.getRegistration();
  return (await registration?.pushManager.getSubscription()) ?? null;
}

async function readyPushManager() {
  const registration = await withTimeout(
    navigator.serviceWorker.ready,
    SERVICE_WORKER_READY_TIMEOUT_MS,
    "The service worker did not become ready.",
  );
  return registration.pushManager;
}

export function PushPermissionOnboarding({ returnFocusRef }: PushPermissionOnboardingProps) {
  const [state, setState] = useState<PanelState>({ kind: "closed" });
  const eventGeneration = useRef(0);

  useEffect(() => {
    async function handleFollowSucceeded(event: Event) {
      const detail = followSucceededDetail(event);
      if (!detail) {
        return;
      }

      const generation = ++eventGeneration.current;
      const snapshot = pushCapabilitySnapshot();
      const availability = classifyPushAvailability(snapshot);
      const shouldOffer = shouldConsiderPushOnboarding({
        created: detail.created,
        isStandalone: snapshot.isStandalone,
      });
      const dismissed = wasPushOnboardingDismissed(sessionStorage);

      if (availability === "offer" && snapshot.permission === "granted") {
        try {
          const synchronization = await syncExistingPushSubscription({
            getExistingSubscription: currentPushSubscription,
            storeSubscription,
          });

          if (generation !== eventGeneration.current) {
            return;
          }
          if (synchronization === "synced") {
            setState({ kind: "closed" });
            return;
          }
        } catch {
          if (generation !== eventGeneration.current) {
            return;
          }
          if (shouldOffer && !dismissed) {
            setState({ kind: "error" });
          }
          return;
        }
      }

      if (generation !== eventGeneration.current || !shouldOffer || dismissed) {
        setState({ kind: "closed" });
        return;
      }

      setState({ kind: availability });
    }

    window.addEventListener(FOLLOW_SUCCEEDED_EVENT, handleFollowSucceeded);
    return () => {
      eventGeneration.current += 1;
      window.removeEventListener(FOLLOW_SUCCEEDED_EVENT, handleFollowSucceeded);
    };
  }, []);

  function closePanel(remember: boolean) {
    if (remember) {
      dismissPushOnboarding(sessionStorage);
    }
    setState({ kind: "closed" });
    window.requestAnimationFrame(() => returnFocusRef.current?.focus());
  }

  async function enable() {
    setState({ kind: "enabling" });

    try {
      const result = await enablePushNotifications({
        getPermission: () => Notification.permission,
        getPushManager: readyPushManager,
        loadPublicVapidKey,
        requestPermission: () => Notification.requestPermission(),
        storeSubscription,
      });

      if (result === "enabled") {
        setState({ kind: "enabled" });
      } else if (result === "denied") {
        setState({ kind: "denied" });
      } else {
        setState({ kind: "permission-dismissed" });
      }
    } catch {
      setState({ kind: "error" });
    }
  }

  if (state.kind === "closed") {
    return null;
  }

  const content = {
    denied: {
      description:
        "This program is still followed. If you change your mind, allow Athenvia in your device or browser notification settings.",
      title: "Notifications are blocked",
    },
    enabled: {
      description:
        "Athenvia can now send application reminders to this device. Your browser remains in control.",
      title: "Reminders are on",
    },
    enabling: {
      description: "Keep this page open while Athenvia securely connects this device.",
      title: "Turning on reminders…",
    },
    error: {
      description:
        "Your Follow is saved. Athenvia could not connect reminders right now, so you can safely try again.",
      title: "Reminders need another try",
    },
    "install-required": {
      description:
        "On iPhone or iPad (iOS 16.4 or later), open the Share menu, choose Add to Home Screen, then open Athenvia from its icon and tap Follow again. Your current Follow is already saved.",
      title: "Install Athenvia for reminders",
    },
    offer: {
      description:
        "Athenvia can alert you before applications open or close. Your Follow is already saved, whatever you choose.",
      title: "Get reminders for this program",
    },
    "permission-dismissed": {
      description:
        "No problem—this program is still followed. You can choose reminders after another Follow.",
      title: "Reminders are still off",
    },
    unsupported: {
      description:
        "This browser cannot set up Web Push here. Your Follow is saved and the rest of Athenvia will keep working.",
      title: "Push is not supported here",
    },
  }[state.kind];

  return (
    <aside
      aria-busy={state.kind === "enabling"}
      aria-labelledby="push-onboarding-title"
      aria-live="polite"
      className={styles.panel}
    >
      <div className={styles.copy}>
        <p className={styles.eyebrow}>Optional reminders</p>
        <h3 id="push-onboarding-title">{content.title}</h3>
        <p>{content.description}</p>
      </div>

      <div className={styles.actions}>
        {state.kind === "offer" || state.kind === "error" ? (
          <button className={styles.primaryAction} type="button" onClick={() => void enable()}>
            {state.kind === "error" ? "Try again" : "Turn on reminders"}
          </button>
        ) : null}
        {state.kind === "enabling" ? (
          <button className={styles.primaryAction} type="button" disabled>
            Turning on…
          </button>
        ) : null}
        {state.kind !== "enabling" ? (
          <button
            className={styles.secondaryAction}
            type="button"
            onClick={() => closePanel(state.kind !== "enabled")}
          >
            {state.kind === "offer" || state.kind === "error" ? "Not now" : "Done"}
          </button>
        ) : null}
      </div>
    </aside>
  );
}
