export type SafeTextLimits = {
  maximumHtmlBytes: number;
  maximumHtmlTags: number;
  maximumNestingDepth: number;
  maximumOutputCharacters: number;
  maximumPdfBytes: number;
  maximumPdfCMapEntries: number;
  maximumPdfDecodedBytes: number;
  maximumPdfObjects: number;
  maximumPdfOperations: number;
  maximumPdfStreamBytes: number;
  maximumPdfStreams: number;
};

export const DEFAULT_SAFE_TEXT_LIMITS: Readonly<SafeTextLimits> = Object.freeze({
  maximumHtmlBytes: 5 * 1024 * 1024,
  maximumHtmlTags: 200_000,
  maximumNestingDepth: 256,
  maximumOutputCharacters: 1_000_000,
  maximumPdfBytes: 8 * 1024 * 1024,
  maximumPdfCMapEntries: 65_536,
  maximumPdfDecodedBytes: 24 * 1024 * 1024,
  maximumPdfObjects: 50_000,
  maximumPdfOperations: 500_000,
  maximumPdfStreamBytes: 4 * 1024 * 1024,
  maximumPdfStreams: 2_000,
});

export function resolveLimits(overrides: Partial<SafeTextLimits> = {}): SafeTextLimits {
  const limits = { ...DEFAULT_SAFE_TEXT_LIMITS, ...overrides };

  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError(`${name} must be a positive safe integer.`);
    }
  }

  return limits;
}

