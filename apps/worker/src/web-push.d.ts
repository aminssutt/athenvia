declare module "web-push" {
  export interface PushSubscription {
    endpoint: string;
    keys: {
      auth: string;
      p256dh: string;
    };
  }

  export interface RequestOptions {
    TTL?: number;
    timeout?: number;
    topic?: string;
    urgency?: "very-low" | "low" | "normal" | "high";
    vapidDetails?: {
      privateKey: string;
      publicKey: string;
      subject: string;
    };
  }

  export function sendNotification(
    subscription: PushSubscription,
    payload?: string,
    options?: RequestOptions,
  ): Promise<unknown>;

  const webPush: {
    sendNotification: typeof sendNotification;
  };
  export default webPush;
}
