const MAXIMUM_TOKEN_COUNT = 6;
const SIGNIFICANT_TOKEN_LENGTH = 3;
const COMBINING_MARKS_PATTERN = new RegExp("[\\u0300-\\u036f]", "gu");

/**
 * Splits a query into the tokens the SQL matchers AND together. Every result
 * is strictly `[a-z0-9]+`, so tokens can be embedded in regex and LIKE
 * patterns without escaping. Short connectives ("de", "of") are dropped when
 * a significant token exists, so "université de lyon" does not require the
 * literal word "de" in every match; a query made only of short tokens keeps
 * them all rather than matching nothing.
 */
export function searchQueryTokens(query: string): string[] {
  const tokens = query
    .toLowerCase()
    .normalize("NFKD")
    .replace(COMBINING_MARKS_PATTERN, "")
    .split(/[^a-z0-9]+/u)
    .filter((token) => token.length > 0);
  const significant = tokens.filter((token) => token.length >= SIGNIFICANT_TOKEN_LENGTH);
  const kept = significant.length > 0 ? significant : tokens;
  return [...new Set(kept)].slice(0, MAXIMUM_TOKEN_COUNT);
}
