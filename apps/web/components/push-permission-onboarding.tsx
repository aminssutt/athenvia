"use client";

import { useEffect, useRef, useState } from "react";

import {
  pushCapabilitySnapshot,
  requestPushSubscription,
  syncPushSubscription,
} from "./push-enable";
import {
  classifyPushAvailability,
  dismissPushOnboarding,
  FOLLOW_SUCCEEDED_EVENT,
  shouldConsiderPushOnboarding,
  wasPushOnboardingDismissed,
} from "./push-permission";
import styles from "./push-permission-onboarding.module.css";

import type { FollowSucceededDetail } from "./push-permission";
import type { RefObject } from "react";

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
          const synchronization = await syncPushSubscription();

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
      const result = await requestPushSubscription();

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
