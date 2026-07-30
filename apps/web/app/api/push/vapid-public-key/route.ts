import { loadPublicVapidKey } from "./public-key";

export const dynamic = "force-dynamic";

export function GET(): Response {
  try {
    return Response.json(
      {
        publicKey: loadPublicVapidKey(process.env.VAPID_PUBLIC_KEY),
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    const requestId = crypto.randomUUID();
    console.error(
      `[vapid-public-key:${requestId}] public key configuration is invalid`,
      error instanceof Error ? error.message : "Unknown configuration error",
    );

    return Response.json(
      {
        error: {
          code: "PUSH_CONFIGURATION_UNAVAILABLE",
          message: "Push notifications are not available right now.",
        },
      },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": "60",
        },
      },
    );
  }
}
