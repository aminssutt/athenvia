import { describe, expect, it } from "vitest";

import { classifyDevicePushState } from "@/components/push-permission";

import { devicePushCopy } from "./push-device";

import type { PushCapabilitySnapshot } from "@/components/push-permission";
import type { DevicePushState } from "./push-device";

const ALL_STATES: DevicePushState[] = [
  "checking",
  "denied",
  "enabling",
  "error",
  "install-required",
  "offer",
  "permission-dismissed",
  "subscribed",
  "unsupported",
];

const ACTIONABLE_STATES: DevicePushState[] = ["enabling", "error", "offer", "permission-dismissed"];

function snapshot(overrides: Partial<PushCapabilitySnapshot> = {}): PushCapabilitySnapshot {
  return {
    hasNotificationApi: true,
    hasPushManager: true,
    hasServiceWorker: true,
    isIos: false,
    isSecureContext: true,
    isStandalone: false,
    permission: "default",
    ...overrides,
  };
}

describe("classifyDevicePushState", () => {
  it("reports a device already covered by a granted permission and a live subscription", () => {
    expect(
      classifyDevicePushState({
        hasLocalSubscription: true,
        snapshot: snapshot({ permission: "granted" }),
      }),
    ).toBe("subscribed");
  });

  it("still offers activation when the permission is granted without a local subscription", () => {
    expect(
      classifyDevicePushState({
        hasLocalSubscription: false,
        snapshot: snapshot({ permission: "granted" }),
      }),
    ).toBe("offer");
  });

  it("ignores a stale subscription left behind by a revoked or unanswered permission", () => {
    expect(
      classifyDevicePushState({
        hasLocalSubscription: true,
        snapshot: snapshot({ permission: "denied" }),
      }),
    ).toBe("denied");
    expect(
      classifyDevicePushState({
        hasLocalSubscription: true,
        snapshot: snapshot({ permission: "default" }),
      }),
    ).toBe("offer");
  });

  it.each([
    {
      expected: "install-required",
      overrides: { isIos: true, isStandalone: false, permission: null },
    },
    { expected: "unsupported", overrides: { hasPushManager: false } },
    { expected: "unsupported", overrides: { isSecureContext: false } },
    { expected: "denied", overrides: { permission: "denied" as const } },
    { expected: "offer", overrides: {} },
  ])("keeps the capability verdict as $expected", ({ expected, overrides }) => {
    expect(
      classifyDevicePushState({ hasLocalSubscription: false, snapshot: snapshot(overrides) }),
    ).toBe(expected);
  });
});

describe("devicePushCopy", () => {
  it("renders nothing before the browser capability is known", () => {
    expect(devicePushCopy("checking")).toBeNull();
  });

  it.each(ALL_STATES.filter((state) => state !== "checking"))(
    "explains the %s state with a title and a description",
    (state) => {
      const copy = devicePushCopy(state);

      expect(copy?.title.length).toBeGreaterThan(0);
      expect(copy?.description.length).toBeGreaterThan(0);
    },
  );

  it.each(ACTIONABLE_STATES)("offers an explicit activation button for %s", (state) => {
    expect(devicePushCopy(state)?.actionLabel).not.toBeNull();
  });

  it.each(ALL_STATES.filter((state) => !ACTIONABLE_STATES.includes(state) && state !== "checking"))(
    "hides the activation button for %s",
    (state) => {
      expect(devicePushCopy(state)?.actionLabel).toBeNull();
    },
  );

  it("tells the owner that this device is already subscribed", () => {
    expect(devicePushCopy("subscribed")?.title).toMatch(/on for this device/i);
  });

  it("points iOS owners to Add to Home Screen instead of an activation button", () => {
    const copy = devicePushCopy("install-required");

    expect(copy?.description).toMatch(/Add to Home Screen/i);
    expect(copy?.actionLabel).toBeNull();
  });

  it("tells a blocked device where the permission can be restored", () => {
    expect(devicePushCopy("denied")?.description).toMatch(/browser or system settings/i);
  });
});
