import { type NextRequest, NextResponse } from "next/server";

import { REQUEST_ID_HEADER } from "./lib/request-id";

export function proxy(request: NextRequest): NextResponse {
  // Never trust a client-supplied correlation ID: an external reverse proxy
  // cannot be distinguished from the public request at this layer.
  const requestId = crypto.randomUUID();
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(REQUEST_ID_HEADER, requestId);

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
