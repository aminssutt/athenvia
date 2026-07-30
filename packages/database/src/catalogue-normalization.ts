const COMBINING_MARKS = /\p{Mark}+/gu;
const AMPERSANDS = /&/gu;
const NON_ALPHANUMERIC = /[^\p{Letter}\p{Number}]+/gu;
const WHITESPACE = /\s+/gu;

/**
 * Canonical comparison form for university names, program names and aliases.
 * Display values remain untouched; this value is only for matching and indexes.
 */
export function normalizeCatalogueName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .replace(AMPERSANDS, " and ")
    .toLocaleLowerCase("en-US")
    .replace(NON_ALPHANUMERIC, " ")
    .replace(WHITESPACE, " ")
    .trim();
}

export function normalizeOfficialDomain(value: string | null | undefined): string | null {
  const candidate = value?.trim();
  if (!candidate) {
    return null;
  }

  try {
    const scheme = /^([a-z][a-z0-9+.-]*):/iu.exec(candidate)?.[1]?.toLowerCase();
    if (scheme && scheme !== "http" && scheme !== "https") {
      return null;
    }
    const url = new URL(scheme ? candidate : `https://${candidate}`);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
      return null;
    }
    return url.hostname
      .toLocaleLowerCase("en-US")
      .replace(/^www\./u, "")
      .replace(/\.$/u, "");
  } catch {
    return null;
  }
}

export function normalizeOfficialUrl(value: string | null | undefined): string | null {
  const candidate = value?.trim();
  if (!candidate) {
    return null;
  }
  try {
    const url = new URL(candidate);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
      return null;
    }
    const hostname = url.hostname
      .toLocaleLowerCase("en-US")
      .replace(/^www\./u, "")
      .replace(/\.$/u, "");
    const port =
      url.port &&
      !(
        (url.protocol === "https:" && url.port === "443") ||
        (url.protocol === "http:" && url.port === "80")
      )
        ? `:${url.port}`
        : "";
    const pathname = url.pathname.replace(/\/{2,}/gu, "/").replace(/\/$/u, "") || "/";
    return `${hostname}${port}${pathname}`;
  } catch {
    return null;
  }
}

function trigrams(value: string): Set<string> {
  const padded = Array.from(`  ${value} `);
  const result = new Set<string>();
  for (let index = 0; index + 2 < padded.length; index += 1) {
    result.add(padded.slice(index, index + 3).join(""));
  }
  return result;
}

export function catalogueNameSimilarity(left: string, right: string): number {
  const normalizedLeft = normalizeCatalogueName(left);
  const normalizedRight = normalizeCatalogueName(right);
  if (!normalizedLeft || !normalizedRight) {
    return 0;
  }
  if (normalizedLeft === normalizedRight) {
    return 1;
  }

  const leftTrigrams = trigrams(normalizedLeft);
  const rightTrigrams = trigrams(normalizedRight);
  let intersection = 0;
  for (const trigram of leftTrigrams) {
    if (rightTrigrams.has(trigram)) {
      intersection += 1;
    }
  }
  return (2 * intersection) / (leftTrigrams.size + rightTrigrams.size);
}
