import { loadPublicVapidKey } from "./public-key";

import { logRequestError } from "@/lib/observability";

export const dynamic = "force-dynamic";

export function GET(request = new Request("http://localhost/api/push/vapid-public-key")): Response {
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
    logRequestError(request, {
      code: "VAPID_PUBLIC_KEY_INVALID",
      error,
      route: "/api/push/vapid-public-key",
    });

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
