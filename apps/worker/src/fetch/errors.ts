export type OfficialSourceFetchErrorCode =
  | "BROWSER_LIMIT"
  | "BROWSER_UNAVAILABLE"
  | "DOMAIN_NOT_APPROVED"
  | "HTTP_ERROR"
  | "INVALID_TARGET"
  | "PRIVATE_TARGET"
  | "REDIRECT_LIMIT"
  | "RESPONSE_TOO_LARGE"
  | "ROBOTS_DENIED"
  | "ROBOTS_UNAVAILABLE"
  | "TIMEOUT"
  | "UNSUPPORTED_CONTENT_TYPE";

export class OfficialSourceFetchError extends Error {
  constructor(
    readonly code: OfficialSourceFetchErrorCode,
    message: string,
    readonly details: Record<string, string | number> = {},
  ) {
    super(message);
    this.name = "OfficialSourceFetchError";
  }
}
