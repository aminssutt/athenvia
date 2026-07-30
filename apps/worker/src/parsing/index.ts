import { SafeTextExtractionError, type SafeTextErrorCode } from "./errors";
import { extractHtmlText } from "./html";
import { resolveLimits, type SafeTextLimits } from "./limits";
import { extractPdfText } from "./pdf";
import { TextCollector } from "./text-collector";

export type SafeTextFormat = "html" | "pdf" | "plain";

export type SafeTextInput = {
  body: Buffer | Uint8Array | string;
  contentType: string;
};

export type SafeTextStats = {
  cmapEntries?: number;
  htmlTagsVisited?: number;
  inputBytes: number;
  objectsVisited?: number;
  outputCharacters: number;
  pageCount?: number;
  streamsDecoded?: number;
  streamsSkipped?: number;
};

export type SafeTextResult = {
  format: SafeTextFormat;
  stats: Readonly<SafeTextStats>;
  text: string;
  warnings: readonly string[];
};

export type SafeTextExtractionEvent =
  | {
      code: SafeTextErrorCode;
      format: SafeTextFormat | "unknown";
      inputBytes: number;
      outcome: "failure";
      retryable: boolean;
    }
  | {
      format: SafeTextFormat;
      inputBytes: number;
      outcome: "success";
      outputCharacters: number;
      warnings: number;
    };

export type SafeTextOptions = {
  limits?: Partial<SafeTextLimits>;
  onEvent?: (event: Readonly<SafeTextExtractionEvent>) => void;
};

function normalizedContentType(contentType: string): string {
  return contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function formatForContentType(contentType: string): SafeTextFormat | null {
  if (contentType === "text/html" || contentType === "application/xhtml+xml") {
    return "html";
  }
  if (contentType === "application/pdf") {
    return "pdf";
  }
  if (contentType === "text/plain") {
    return "plain";
  }
  return null;
}

function bodyBuffer(body: SafeTextInput["body"]): Buffer {
  if (typeof body === "string") {
    return Buffer.from(body, "utf8");
  }
  return Buffer.isBuffer(body)
    ? body
    : Buffer.from(body.buffer, body.byteOffset, body.byteLength);
}

function notify(
  observer: SafeTextOptions["onEvent"],
  event: Readonly<SafeTextExtractionEvent>,
): void {
  try {
    observer?.(Object.freeze(event));
  } catch {
    // Telemetry must never alter extraction or expose document content through a second failure.
  }
}

function extractPlainText(body: Buffer, limits: SafeTextLimits): string {
  if (body.length > limits.maximumHtmlBytes) {
    throw new SafeTextExtractionError(
      "INPUT_TOO_LARGE",
      "Plain-text input exceeded the configured byte limit.",
      { inputBytes: body.length, maximumBytes: limits.maximumHtmlBytes },
    );
  }

  const collector = new TextCollector(limits.maximumOutputCharacters);
  collector.text(new TextDecoder("utf-8").decode(body));
  return collector.finish();
}

export function extractSafeText(
  input: SafeTextInput,
  options: SafeTextOptions = {},
): SafeTextResult {
  const limits = resolveLimits(options.limits);
  const body = bodyBuffer(input.body);
  const format = formatForContentType(normalizedContentType(input.contentType));

  try {
    if (!format) {
      throw new SafeTextExtractionError(
        "UNSUPPORTED_CONTENT_TYPE",
        "Content type is not eligible for safe text extraction.",
        { contentType: normalizedContentType(input.contentType).slice(0, 128) },
      );
    }

    let result: SafeTextResult;

    if (format === "html") {
      const extracted = extractHtmlText(body, limits);
      result = {
        format,
        stats: Object.freeze({
          htmlTagsVisited: extracted.stats.tagsVisited,
          inputBytes: body.length,
          outputCharacters: extracted.text.length,
        }),
        text: extracted.text,
        warnings: Object.freeze([]),
      };
    } else if (format === "pdf") {
      const extracted = extractPdfText(body, limits);
      result = {
        format,
        stats: Object.freeze({
          ...extracted.stats,
          inputBytes: body.length,
          outputCharacters: extracted.text.length,
        }),
        text: extracted.text,
        warnings: Object.freeze(extracted.warnings),
      };
    } else {
      const text = extractPlainText(body, limits);
      result = {
        format,
        stats: Object.freeze({
          inputBytes: body.length,
          outputCharacters: text.length,
        }),
        text,
        warnings: Object.freeze([]),
      };
    }

    notify(options.onEvent, {
      format,
      inputBytes: body.length,
      outcome: "success",
      outputCharacters: result.text.length,
      warnings: result.warnings.length,
    });
    return Object.freeze(result);
  } catch (cause) {
    const error =
      cause instanceof SafeTextExtractionError
        ? cause
        : new SafeTextExtractionError(
            "PARSING_FAILED",
            "Safe text extraction failed unexpectedly.",
            {},
            { cause },
          );

    notify(options.onEvent, {
      code: error.code,
      format: format ?? "unknown",
      inputBytes: body.length,
      outcome: "failure",
      retryable: error.retryable,
    });
    throw error;
  }
}

export { SafeTextExtractionError } from "./errors";
export { DEFAULT_SAFE_TEXT_LIMITS, type SafeTextLimits } from "./limits";

