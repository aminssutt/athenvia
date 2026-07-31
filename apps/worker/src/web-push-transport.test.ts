import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { UnsafePushEndpointError } from "./push-endpoint-safety";
import { WebPushNotificationTransport } from "./web-push-transport";

import type { NotificationPayload } from "@athenvia/contracts";
import type { WebPushSender } from "./web-push-transport";

const configuration = {
  privateKey: "private-key",
  publicKey: "public-key",
  subject: "mailto:admin@example.test",
};

const subscription = {
  auth: "auth-secret",
  endpoint: "https://push.example.test/subscriptions/browser-1",
  id: "subscription-1",
  p256dh: "p256dh-key",
};

const payload: NotificationPayload = {
  body: "Applications open tomorrow.",
  dateStatus: "CONFIRMED",
  dedupeKey: "delivery-0001",
  deepLink: "/programs/6a1f9a53-8b5b-4a52-9d1e-2f4f14f4a2c1",
  programId: "6a1f9a53-8b5b-4a52-9d1e-2f4f14f4a2c1",
  scheduledFor: "2026-07-31T00:00:00.000Z",
  title: "Application opening",
  type: "APPLICATION_OPENING",
  watchlistId: "2b8ed7f5-93b8-4a63-8f6e-0c62e35f2d84",
};

function recordingSender(): { calls: unknown[]; sender: WebPushSender } {
  const calls: unknown[] = [];
  return {
    calls,
    sender: {
      sendNotification: async (...args: unknown[]) => {
        calls.push(args);
        return { body: "", headers: {}, statusCode: 201 };
      },
    } as unknown as WebPushSender,
  };
}

describe("WebPushNotificationTransport endpoint re-validation", () => {
  it("sends only after the endpoint resolves to public addresses", async () => {
    const { calls, sender } = recordingSender();
    const transport = new WebPushNotificationTransport(configuration, sender, async () => [
      "93.184.216.34",
    ]);

    await transport.send(subscription, payload);

    assert.equal(calls.length, 1);
  });

  it("refuses to POST toward an endpoint that resolves to a private address", async () => {
    const { calls, sender } = recordingSender();
    const transport = new WebPushNotificationTransport(configuration, sender, async () => [
      "169.254.169.254",
    ]);

    await assert.rejects(transport.send(subscription, payload), UnsafePushEndpointError);
    assert.equal(calls.length, 0);
  });
});
