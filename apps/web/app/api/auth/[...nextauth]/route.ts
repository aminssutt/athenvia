import NextAuth from "next-auth";

import { authOptions } from "@/lib/auth";
import { normalizeEmailIdentifier } from "@/lib/auth-config";
import { isValidAuthCsrfToken } from "@/lib/auth-csrf";
import { allowMagicLinkRequest } from "@/lib/auth-rate-limit";

const handler = NextAuth(authOptions);

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type AuthRouteContext = {
  params: Promise<{ nextauth: string[] }>;
};

function genericCheckEmailResponse(request: Request, wantsJson: boolean): Response {
  const destination = new URL("/sign-in/check-email", request.url);
  const headers = {
    "Cache-Control": "no-store",
  };

  if (wantsJson) {
    return Response.json({ url: destination.toString() }, { headers });
  }

  return Response.redirect(destination, 302);
}

export const GET = handler;

export async function POST(request: Request, context: AuthRouteContext): Promise<Response> {
  const { nextauth } = await context.params;
  if (nextauth[0] === "signin" && nextauth[1] === "email") {
    let body: FormData;

    try {
      body = await request.clone().formData();
    } catch {
      return handler(request, context);
    }

    const csrfToken = String(body.get("csrfToken") ?? "");
    const secret = process.env.AUTH_SECRET ?? "";

    if (isValidAuthCsrfToken(request.headers.get("cookie"), csrfToken, secret)) {
      const identifier = String(body.get("email") ?? "");
      let rateLimitIdentifier: string;

      try {
        rateLimitIdentifier = normalizeEmailIdentifier(identifier);
      } catch {
        rateLimitIdentifier = identifier.trim().toLowerCase().slice(0, 320);
      }

      if (!(await allowMagicLinkRequest(request, rateLimitIdentifier))) {
        return genericCheckEmailResponse(request, body.get("json") === "true");
      }
    }
  }

  return handler(request, context);
}
