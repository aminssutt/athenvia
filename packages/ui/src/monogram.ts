const MONOGRAM_LENGTH = 2;

function wordCharacters(value: string): string[] {
  return Array.from(value.match(/\p{L}|\p{N}/gu)?.join("") ?? "");
}

/**
 * Builds a short, neutral identifier for an institution when no approved logo
 * is available. The function supports accented and non-Latin names.
 */
export function getUniversityMonogram(universityName: string): string {
  const words = universityName
    .trim()
    .split(/\s+/u)
    .map(wordCharacters)
    .filter((word) => word.length > 0);

  if (words.length === 0) {
    return "U";
  }

  if (words.length === 1) {
    return words[0].slice(0, MONOGRAM_LENGTH).join("").toLocaleUpperCase();
  }

  return `${words[0][0]}${words.at(-1)?.[0] ?? ""}`.toLocaleUpperCase();
}
