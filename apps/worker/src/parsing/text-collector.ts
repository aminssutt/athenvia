import { SafeTextExtractionError } from "./errors";

// The extractor deliberately removes C0/C1 controls and bidi format controls.
const DANGEROUS_FORMAT_CONTROLS =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b\u200e\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/gu;
const INLINE_WHITESPACE = /[^\S\r\n]+/gu;
const MANY_NEWLINES = /\n{3,}/gu;

export class TextCollector {
  private readonly chunks: string[] = [];
  private length = 0;
  private pendingSeparator: "line" | "space" | null = null;

  constructor(private readonly maximumCharacters: number) {}

  line(): void {
    if (this.length > 0) {
      this.pendingSeparator = "line";
    }
  }

  space(): void {
    if (this.length > 0 && this.pendingSeparator !== "line") {
      this.pendingSeparator = "space";
    }
  }

  text(value: string): void {
    const hadLeadingWhitespace = /^\s/u.test(value);
    const hadTrailingWhitespace = /\s$/u.test(value);
    const cleaned = value
      .replace(DANGEROUS_FORMAT_CONTROLS, "")
      .replace(/\r\n?/gu, "\n")
      .replace(INLINE_WHITESPACE, " ")
      .replace(MANY_NEWLINES, "\n\n")
      .trim();

    if (!cleaned) {
      if (hadLeadingWhitespace || hadTrailingWhitespace) {
        this.space();
      }
      return;
    }

    if (hadLeadingWhitespace) {
      this.space();
    }

    this.flushSeparator();
    this.append(cleaned);

    if (hadTrailingWhitespace) {
      this.space();
    }
  }

  finish(): string {
    return this.chunks
      .join("")
      .normalize("NFC")
      .split("\n")
      .map((line) => line.trim())
      .filter((line, index, lines) => line || (index > 0 && lines[index - 1]))
      .join("\n")
      .replace(MANY_NEWLINES, "\n\n")
      .trim();
  }

  private append(value: string): void {
    if (this.length + value.length > this.maximumCharacters) {
      throw new SafeTextExtractionError(
        "OUTPUT_TOO_LARGE",
        "Extracted text exceeded the configured output limit.",
        { maximumCharacters: this.maximumCharacters },
      );
    }

    this.chunks.push(value);
    this.length += value.length;
  }

  private flushSeparator(): void {
    if (!this.pendingSeparator || this.length === 0) {
      this.pendingSeparator = null;
      return;
    }

    const separator = this.pendingSeparator === "line" ? "\n" : " ";
    const lastChunk = this.chunks.at(-1) ?? "";

    if (!lastChunk.endsWith(separator)) {
      this.append(separator);
    }

    this.pendingSeparator = null;
  }
}
