const PRIVATE_RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "Referrer-Policy": "no-referrer",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
} as const;

export function privateJson(
  body: unknown,
  init: Omit<ResponseInit, "headers"> & { headers?: HeadersInit } = {},
): Response {
  const headers = new Headers(PRIVATE_RESPONSE_HEADERS);

  if (init.headers) {
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  }

  return Response.json(body, { ...init, headers });
}

export function isSameOriginMutation(request: Request): boolean {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");

  if (!origin || (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none")) {
    return false;
  }

  try {
    const configuredOrigin = process.env.NEXTAUTH_URL
      ? new URL(process.env.NEXTAUTH_URL).origin
      : null;
    return new URL(origin).origin === (configuredOrigin ?? new URL(request.url).origin);
  } catch {
    return false;
  }
}

export function forbiddenMutationResponse(): Response {
  return privateJson({ error: "Request origin could not be verified." }, { status: 403 });
}
