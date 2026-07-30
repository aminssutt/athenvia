export type SafeTextLimits = {
  maximumHtmlBytes: number;
  maximumHtmlTags: number;
  maximumNestingDepth: number;
  maximumOutputCharacters: number;
  maximumPdfBytes: number;
  maximumPdfCMaps: number;
  maximumPdfCMapEntries: number;
  maximumPdfDecodedBytes: number;
  maximumPdfObjects: number;
  maximumPdfOperations: number;
  maximumPdfStringBytes: number;
  maximumPdfStreamBytes: number;
  maximumPdfStreams: number;
};

export const DEFAULT_SAFE_TEXT_LIMITS: Readonly<SafeTextLimits> = Object.freeze({
  maximumHtmlBytes: 5 * 1024 * 1024,
  maximumHtmlTags: 200_000,
  maximumNestingDepth: 256,
  maximumOutputCharacters: 1_000_000,
  maximumPdfBytes: 8 * 1024 * 1024,
  maximumPdfCMaps: 64,
  maximumPdfCMapEntries: 65_536,
  maximumPdfDecodedBytes: 24 * 1024 * 1024,
  maximumPdfObjects: 50_000,
  maximumPdfOperations: 500_000,
  maximumPdfStringBytes: 256 * 1024,
  maximumPdfStreamBytes: 4 * 1024 * 1024,
  maximumPdfStreams: 2_000,
});

export function resolveLimits(overrides: Partial<SafeTextLimits> = {}): SafeTextLimits {
  for (const name of Object.keys(overrides)) {
    if (!Object.hasOwn(DEFAULT_SAFE_TEXT_LIMITS, name)) {
      throw new TypeError(`Unknown safe-text limit: ${name}.`);
    }
  }

  const limits = { ...DEFAULT_SAFE_TEXT_LIMITS };
  for (const name of Object.keys(DEFAULT_SAFE_TEXT_LIMITS) as Array<keyof SafeTextLimits>) {
    const value = overrides[name] ?? DEFAULT_SAFE_TEXT_LIMITS[name];
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError(`${name} must be a positive safe integer.`);
    }
    if (value > DEFAULT_SAFE_TEXT_LIMITS[name]) {
      throw new RangeError(`${name} cannot exceed its process safety ceiling.`);
    }
    limits[name] = value;
  }

  return limits;
}
