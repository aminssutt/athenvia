import { extractDateCandidates } from "../parsing";

import type { DateCandidate, DateCandidateKind, DateCandidateOptions } from "../parsing";
import type { IntakeDateEvidence } from "../verification";

const MAXIMUM_PROMPT_CHARACTERS = 20_000;
const MAXIMUM_CLAIMS = 20;
const MAXIMUM_QUOTE_CHARACTERS = 300;

/**
 * One statement the model located in the official page text. The quote must
 * be verbatim: claims whose quote does not literally appear in the snapshot
 * text are discarded, and the date value itself is always re-derived from the
 * quote by the deterministic parser. The model locates and disambiguates; it
 * never computes or invents a date.
 */
export type LlmDateClaim = {
  quote: string;
  kind: "APPLICATION_DEADLINE" | "APPLICATION_OPEN";
  intakeYear?: number;
  intakeMonth?: number;
  roundName?: string | null;
};

export type LlmExtractionInput = {
  text: string;
  programName: string | null;
  intakes: readonly { year: number; month: number | null }[];
};

export type LlmDateExtractor = (input: LlmExtractionInput) => Promise<LlmDateClaim[]>;

export type GeminiExtractorOptions = {
  apiKey: string;
  model: string;
  fetchImplementation?: typeof fetch;
};

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    claims: {
      type: "array",
      items: {
        type: "object",
        properties: {
          quote: { type: "string" },
          kind: { type: "string", enum: ["APPLICATION_DEADLINE", "APPLICATION_OPEN"] },
          intakeYear: { type: "integer" },
          intakeMonth: { type: "integer" },
          roundName: { type: "string" },
        },
        required: ["quote", "kind"],
      },
    },
  },
  required: ["claims"],
} as const;

function extractionPrompt(input: LlmExtractionInput): string {
  const intakeList = input.intakes
    .map((intake) =>
      intake.month
        ? `${intake.year}-${String(intake.month).padStart(2, "0")}`
        : String(intake.year),
    )
    .join(", ");
  return [
    "You locate application dates for a university programme inside the official page text below.",
    `Programme: ${input.programName ?? "unknown"}. Tracked intakes: ${intakeList || "unknown"}.`,
    "Return every statement that gives an application deadline (kind APPLICATION_DEADLINE) or an application opening (kind APPLICATION_OPEN).",
    "Rules:",
    "- quote MUST be copied verbatim from the text, including the full sentence containing the date. Never paraphrase, translate, reformat or complete a date.",
    "- Set intakeYear/intakeMonth only when the surrounding text states which intake the date belongs to.",
    "- Set roundName only when the text names an application round.",
    "- If the text contains no application dates, return an empty claims array.",
    "",
    "TEXT:",
    input.text.slice(0, MAXIMUM_PROMPT_CHARACTERS),
  ].join("\n");
}

/** Calls Gemini with a strict JSON response schema. */
export function createGeminiDateExtractor(options: GeminiExtractorOptions): LlmDateExtractor {
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    options.model,
  )}:generateContent`;

  return async (input) => {
    const response = await fetchImplementation(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": options.apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: extractionPrompt(input) }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
          temperature: 0,
        },
      }),
    });
    if (!response.ok) {
      throw new Error(`Gemini extraction failed with HTTP ${response.status}.`);
    }
    const payload = (await response.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const raw = payload.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as { claims?: unknown };
    if (!Array.isArray(parsed.claims)) {
      return [];
    }
    return parsed.claims
      .filter(
        (claim): claim is LlmDateClaim =>
          typeof claim === "object" &&
          claim !== null &&
          typeof (claim as LlmDateClaim).quote === "string" &&
          ((claim as LlmDateClaim).kind === "APPLICATION_DEADLINE" ||
            (claim as LlmDateClaim).kind === "APPLICATION_OPEN"),
      )
      .slice(0, MAXIMUM_CLAIMS);
  };
}

function normalizeForMatching(value: string): string {
  return value.replace(/\s+/gu, " ").trim().toLowerCase();
}

export type VerifiedLlmEvidenceResult = {
  evidence: IntakeDateEvidence[];
  rejectedQuotes: number;
};

/**
 * Turns model claims into matchable evidence under the citation constraint:
 * the quote must appear verbatim in the snapshot text (whitespace-insensitive)
 * and the deterministic date parser must extract exactly one exact date from
 * the quote alone. The only tolerated parser doubt is MISSING_CONTEXT —
 * supplying the surrounding context is precisely the model's contribution,
 * and every resulting proposal still waits for a human in the review queue.
 * A hallucinated, reshaped or ambiguous quote can never reach the catalogue.
 */
export function verifiedLlmEvidence(
  claims: readonly LlmDateClaim[],
  text: string,
  options: DateCandidateOptions,
): VerifiedLlmEvidenceResult {
  const normalizedText = normalizeForMatching(text);
  const evidence: IntakeDateEvidence[] = [];
  let rejectedQuotes = 0;

  claims.forEach((claim, index) => {
    const quote = claim.quote.trim();
    if (
      quote.length === 0 ||
      quote.length > MAXIMUM_QUOTE_CHARACTERS ||
      !normalizedText.includes(normalizeForMatching(quote))
    ) {
      rejectedQuotes += 1;
      return;
    }

    const candidates = extractDateCandidates(quote, options).filter(
      (candidate) =>
        candidate.localDate !== null &&
        (candidate.precision === "DATE" || candidate.precision === "DATE_TIME") &&
        candidate.reviewReasons.every((reason) => reason === "MISSING_CONTEXT"),
    );
    if (candidates.length !== 1) {
      rejectedQuotes += 1;
      return;
    }
    const parsed = candidates[0]!;
    const kind: DateCandidateKind = parsed.kind === "UNKNOWN" ? claim.kind : parsed.kind;
    if (kind !== claim.kind) {
      // The parser read the opposite meaning from the same sentence; a human
      // must look at it rather than either side winning automatically.
      rejectedQuotes += 1;
      return;
    }
    const candidate: DateCandidate = {
      ...parsed,
      automaticPublication: true,
      kind,
      reviewReasons: [],
    };

    const intakeHint =
      typeof claim.intakeYear === "number" &&
      Number.isInteger(claim.intakeYear) &&
      claim.intakeYear >= 2000 &&
      claim.intakeYear <= 2100
        ? {
            year: claim.intakeYear,
            ...(typeof claim.intakeMonth === "number" &&
            Number.isInteger(claim.intakeMonth) &&
            claim.intakeMonth >= 1 &&
            claim.intakeMonth <= 12
              ? { month: claim.intakeMonth }
              : {}),
          }
        : undefined;

    evidence.push({
      candidate,
      evidenceId: `llm-${index}`,
      ...(intakeHint ? { intakeHint } : {}),
      roundNameHint: claim.roundName?.trim() || null,
    });
  });

  return { evidence, rejectedQuotes };
}
