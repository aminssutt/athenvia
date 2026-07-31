const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export const REQUEST_ID_HEADER = "x-request-id";

export function validRequestId(value: unknown): string | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return typeof candidate === "string" && REQUEST_ID_PATTERN.test(candidate)
    ? candidate.toLowerCase()
    : null;
}

export function requestIdFromRequest(request: Pick<Request, "headers">): string {
  return validRequestId(request.headers.get(REQUEST_ID_HEADER)) ?? crypto.randomUUID();
}
