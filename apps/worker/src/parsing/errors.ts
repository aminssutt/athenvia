export type SafeTextErrorCode =
  | "ENCRYPTED_PDF"
  | "HTML_LIMIT_EXCEEDED"
  | "INPUT_TOO_LARGE"
  | "INVALID_PDF"
  | "OUTPUT_TOO_LARGE"
  | "PARSING_FAILED"
  | "PDF_LIMIT_EXCEEDED"
  | "UNSUPPORTED_CONTENT_TYPE"
  | "UNSUPPORTED_PDF";

export type SafeTextErrorDetails = Readonly<Record<string, boolean | number | string>>;

const RETRYABLE_CODES = new Set<SafeTextErrorCode>(["PARSING_FAILED"]);

export class SafeTextExtractionError extends Error {
  readonly code: SafeTextErrorCode;
  readonly details: SafeTextErrorDetails;
  readonly retryable: boolean;

  constructor(
    code: SafeTextErrorCode,
    message: string,
    details: SafeTextErrorDetails = {},
    options: ErrorOptions = {},
  ) {
    super(message, options);
    this.name = "SafeTextExtractionError";
    this.code = code;
    this.details = Object.freeze({ ...details });
    this.retryable = RETRYABLE_CODES.has(code);
  }

  toJSON() {
    return {
      code: this.code,
      details: this.details,
      message: this.message,
      retryable: this.retryable,
    };
  }
}
