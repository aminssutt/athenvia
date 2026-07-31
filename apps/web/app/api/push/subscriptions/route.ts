import { ECDH } from "node:crypto";
import { isIP } from "node:net";

import {
  PushSubscriptionLimitReachedError,
  PushSubscriptionOwnershipConflictError,
  revokePushSubscription,
  storePushSubscription,
} from "@athenvia/database";
import { z } from "zod";

import { logRequestError } from "@/lib/observability";

import { authenticatedPushUserId, isTrustedPushMutationOrigin } from "./request-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  Vary: "Cookie, Origin",
} as const;

function isSecurePushEndpoint(value: string): boolean {
  try {
    const endpoint = new URL(value);
    const hostname = endpoint.hostname
      .replace(/^\[|\]$/g, "")
      .toLowerCase()
      .replace(/\.$/, "");
    return (
      endpoint.protocol === "https:" &&
      endpoint.username === "" &&
      endpoint.password === "" &&
      endpoint.hash === "" &&
      hostname.includes(".") &&
      hostname !== "localhost" &&
      !hostname.endsWith(".localhost") &&
      !hostname.endsWith(".local") &&
      isIP(hostname) === 0
    );
  } catch {
    return false;
  }
}

function canonicalPushEndpoint(value: string): string {
  const endpoint = new URL(value);
  endpoint.hostname = endpoint.hostname.toLowerCase().replace(/\.$/, "");
  return endpoint.href;
}

function isCanonicalBase64Url(value: string, decodedBytes: number): boolean {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    return false;
  }

  const decoded = Buffer.from(value, "base64url");
  return decoded.length === decodedBytes && decoded.toString("base64url") === value;
}

const EndpointSchema = z
  .string()
  .min(1)
  .max(4_096)
  .refine(isSecurePushEndpoint)
  .transform(canonicalPushEndpoint)
  .pipe(z.string().max(4_096));

const SubscribeRequestSchema = z
  .object({
    endpoint: EndpointSchema,
    expirationTime: z.number().nonnegative().nullable().optional(),
    keys: z
      .object({
        p256dh: z
          .string()
          .length(87)
          .refine((value) => {
            if (!isCanonicalBase64Url(value, 65)) {
              return false;
            }

            const decoded = Buffer.from(value, "base64url");
            if (decoded[0] !== 0x04) {
              return false;
            }

            try {
              ECDH.convertKey(decoded, "prime256v1", undefined, undefined, "uncompressed");
              return true;
            } catch {
              return false;
            }
          }),
        auth: z
          .string()
          .length(22)
          .refine((value) => isCanonicalBase64Url(value, 16)),
      })
      .strict(),
  })
  .strict();

const RevokeRequestSchema = z
  .object({
    endpoint: EndpointSchema,
  })
  .strict();

function emptyResponse(status: number): Response {
  return new Response(null, {
    status,
    headers: RESPONSE_HEADERS,
  });
}

function errorResponse(code: string, message: string, status: number): Response {
  return Response.json(
    {
      error: {
        code,
        message,
      },
    },
    {
      status,
      headers: RESPONSE_HEADERS,
    },
  );
}

async function parseBody(request: Request): Promise<unknown | undefined> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

function isJsonRequest(request: Request): boolean {
  return (
    request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ===
    "application/json"
  );
}

async function authenticatedUserIdOrResponse(
  request: Request,
  unauthorizedMessage: string,
): Promise<Response | string> {
  try {
    const userId = await authenticatedPushUserId();
    return userId ?? errorResponse("UNAUTHORIZED", unauthorizedMessage, 401);
  } catch (error) {
    logRequestError(request, {
      code: "PUSH_OWNER_LOOKUP_FAILED",
      error,
      route: "/api/push/subscriptions",
    });
    return errorResponse(
      "PUSH_SUBSCRIPTION_UNAVAILABLE",
      "Push notification settings are not available right now. Try again soon.",
      503,
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!isTrustedPushMutationOrigin(request)) {
    return errorResponse("UNTRUSTED_ORIGIN", "This request did not originate from Athenvia.", 403);
  }

  if (!isJsonRequest(request)) {
    return errorResponse("UNSUPPORTED_MEDIA_TYPE", "Send an application/json request.", 415);
  }

  const authenticatedUser = await authenticatedUserIdOrResponse(
    request,
    "Sign in before enabling push notifications.",
  );
  if (authenticatedUser instanceof Response) {
    return authenticatedUser;
  }

  const body = SubscribeRequestSchema.safeParse(await parseBody(request));
  if (!body.success) {
    return errorResponse("INVALID_REQUEST", "Provide a valid push subscription.", 400);
  }

  try {
    const userAgent = request.headers.get("user-agent")?.slice(0, 512) || undefined;
    await storePushSubscription({
      userId: authenticatedUser,
      endpoint: body.data.endpoint,
      p256dh: body.data.keys.p256dh,
      auth: body.data.keys.auth,
      userAgent,
    });
    return emptyResponse(204);
  } catch (error) {
    if (
      error instanceof PushSubscriptionOwnershipConflictError ||
      error instanceof PushSubscriptionLimitReachedError
    ) {
      return errorResponse(
        "PUSH_SUBSCRIPTION_CONFLICT",
        "This push subscription cannot be registered for this account.",
        409,
      );
    }

    logRequestError(request, {
      code: "PUSH_SUBSCRIPTION_STORE_FAILED",
      error,
      route: "/api/push/subscriptions",
    });
    return errorResponse(
      "PUSH_SUBSCRIPTION_UNAVAILABLE",
      "The push subscription could not be saved right now. Try again soon.",
      503,
    );
  }
}

export async function DELETE(request: Request): Promise<Response> {
  if (!isTrustedPushMutationOrigin(request)) {
    return errorResponse("UNTRUSTED_ORIGIN", "This request did not originate from Athenvia.", 403);
  }

  if (!isJsonRequest(request)) {
    return errorResponse("UNSUPPORTED_MEDIA_TYPE", "Send an application/json request.", 415);
  }

  const authenticatedUser = await authenticatedUserIdOrResponse(
    request,
    "Sign in before changing push notifications.",
  );
  if (authenticatedUser instanceof Response) {
    return authenticatedUser;
  }

  const body = RevokeRequestSchema.safeParse(await parseBody(request));
  if (!body.success) {
    return errorResponse("INVALID_REQUEST", "Provide a valid push endpoint.", 400);
  }

  try {
    await revokePushSubscription(authenticatedUser, body.data.endpoint);
    return emptyResponse(204);
  } catch (error) {
    logRequestError(request, {
      code: "PUSH_SUBSCRIPTION_REVOKE_FAILED",
      error,
      route: "/api/push/subscriptions",
    });
    return errorResponse(
      "PUSH_SUBSCRIPTION_UNAVAILABLE",
      "The push subscription could not be revoked right now. Try again soon.",
      503,
    );
  }
}
