import { createHash } from "node:crypto";

import webPush from "web-push";

import type { NotificationPayload } from "@athenvia/contracts";
import type { VapidConfiguration } from "./vapid-config";

export const WEB_PUSH_TTL_SECONDS = 15 * 60;
export const WEB_PUSH_TIMEOUT_MILLISECONDS = 10_000;

export interface ActivePushSubscription {
  auth: string;
  endpoint: string;
  id: string;
  p256dh: string;
}

export interface NotificationTransport {
  send(subscription: ActivePushSubscription, payload: NotificationPayload): Promise<void>;
}

export type WebPushSender = Pick<typeof webPush, "sendNotification">;

export function createWebPushTopic(dedupeKey: string): string {
  return createHash("sha256").update(dedupeKey, "utf8").digest("base64url").slice(0, 32);
}

export function minimalWebPushPayload(payload: NotificationPayload): string {
  return JSON.stringify({
    body: payload.body,
    dedupeKey: payload.dedupeKey,
    deepLink: `/programs/${payload.programId}`,
    title: payload.title,
  });
}

export class WebPushNotificationTransport implements NotificationTransport {
  constructor(
    private readonly configuration: VapidConfiguration,
    private readonly sender: WebPushSender = webPush,
  ) {}

  async send(subscription: ActivePushSubscription, payload: NotificationPayload): Promise<void> {
    await this.sender.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: {
          auth: subscription.auth,
          p256dh: subscription.p256dh,
        },
      },
      minimalWebPushPayload(payload),
      {
        TTL: WEB_PUSH_TTL_SECONDS,
        timeout: WEB_PUSH_TIMEOUT_MILLISECONDS,
        topic: createWebPushTopic(payload.dedupeKey),
        urgency: "normal",
        vapidDetails: this.configuration,
      },
    );
  }
}
