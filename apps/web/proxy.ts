import { type NextRequest, NextResponse } from "next/server";

import { REQUEST_ID_HEADER } from "./lib/request-id";

export function proxy(request: NextRequest): NextResponse {
  // Never trust a client-supplied correlation ID: an external reverse proxy
  // cannot be distinguished from the public request at this layer.
  const requestId = crypto.randomUUID();
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(REQUEST_ID_HEADER, requestId);

  // Rate-limit keys derive the client address from forwarding headers. The
  // production deployment (docker-compose.prod.yml) fronts the app with a
  // single reverse proxy that APPENDS the real client address as the LAST
  // `x-forwarded-for` entry; every earlier entry — and `x-real-ip` or
  // `cf-connecting-ip` wholesale — can be forged by the client. Keep only the
  // trusted final hop so spoofed headers cannot rotate rate-limit keys.
  const trustedClientAddress = request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim();
  requestHeaders.delete("cf-connecting-ip");
  if (trustedClientAddress) {
    requestHeaders.set("x-forwarded-for", trustedClientAddress);
    requestHeaders.set("x-real-ip", trustedClientAddress);
  } else {
    requestHeaders.delete("x-forwarded-for");
    requestHeaders.delete("x-real-ip");
  }

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

export const config = {
  matcher: "/api/:path*",
};
