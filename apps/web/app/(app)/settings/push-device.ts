import type { DevicePushAvailability } from "@/components/push-permission";

/**
 * Browser capability plus the outcomes of an activation attempt started from
 * Settings. `checking` is the pre-mount value: capabilities can only be read in
 * the browser, so nothing about this device may be rendered before hydration.
 */
export type DevicePushState =
  "checking" | "enabling" | "error" | "permission-dismissed" | DevicePushAvailability;

export type DevicePushCopy = {
  actionLabel: string | null;
  description: string;
  title: string;
};

const DEVICE_PUSH_COPY: Record<Exclude<DevicePushState, "checking">, DevicePushCopy> = {
  denied: {
    actionLabel: null,
    description:
      "This browser is blocking Athenvia notifications. Allow them again in your browser or system settings, then reopen this page.",
    title: "Notifications are blocked on this device",
  },
  enabling: {
    actionLabel: "Turning on…",
    description: "Keep this page open while Athenvia connects this device.",
    title: "Turning on notifications…",
  },
  error: {
    actionLabel: "Try again",
    description: "Nothing changed on this device, so you can safely try again.",
    title: "Notifications could not be turned on",
  },
  "install-required": {
    actionLabel: null,
    description:
      "Apple only allows notifications for installed apps: open Share, choose Add to Home Screen, then reopen Athenvia from its icon to turn them on.",
    title: "Add Athenvia to your Home Screen first",
  },
  offer: {
    actionLabel: "Turn on notifications on this device",
    description:
      "Athenvia can remind you here before applications open or close. Your browser asks for permission first.",
    title: "Notifications are off on this device",
  },
  "permission-dismissed": {
    actionLabel: "Turn on notifications on this device",
    description: "The browser prompt was closed without an answer. You can ask for it again.",
    title: "Notifications are still off on this device",
  },
  subscribed: {
    actionLabel: null,
    description:
      "Athenvia can send reminders to this browser. Unsubscribe all turns delivery off on every device.",
    title: "Notifications are on for this device",
  },
  unsupported: {
    actionLabel: null,
    description:
      "This browser cannot deliver Web Push. Everything else in Athenvia keeps working here.",
    title: "Push is not available on this device",
  },
};

export function devicePushCopy(state: DevicePushState): DevicePushCopy | null {
  return state === "checking" ? null : DEVICE_PUSH_COPY[state];
}
