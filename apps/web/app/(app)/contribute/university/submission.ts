import { z } from "zod";

function isSafeOfficialWebsite(value: string): boolean {
  if (!value) {
    return true;
  }

  try {
    const parsedUrl = new URL(value);
    return parsedUrl.protocol === "https:" || parsedUrl.protocol === "http:";
  } catch {
    return false;
  }
}

const UniversityNameSchema = z
  .string()
  .trim()
  .min(2, "Enter the university name.")
  .max(120, "Keep the university name under 120 characters.");

const CountrySchema = z
  .string()
  .trim()
  .min(2, "Enter the country.")
  .max(80, "Keep the country under 80 characters.")
  .regex(/\p{L}/u, "Enter a country name.");

export const MissingUniversitySubmissionSchema = z.object({
  universityName: UniversityNameSchema,
  country: CountrySchema,
  officialWebsite: z
    .string()
    .trim()
    .max(2_048, "Keep the website address under 2,048 characters.")
    .refine(isSafeOfficialWebsite, "Enter a full website starting with https:// or http://.")
    .transform((value) => (value ? new URL(value).toString() : null)),
});

const ValidatedMissingUniversitySubmissionSchema = z.object({
  universityName: UniversityNameSchema,
  country: CountrySchema,
  officialWebsite: z.string().url().refine(isSafeOfficialWebsite).nullable(),
});

const SubmissionResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("pending_review"),
    submissionId: z.string().min(1),
  }),
  z.object({
    status: z.literal("unavailable"),
  }),
]);

export type MissingUniversitySubmission = z.output<typeof MissingUniversitySubmissionSchema>;
export type SubmissionResult = z.infer<typeof SubmissionResultSchema>;
export type SubmissionTransport = (submission: MissingUniversitySubmission) => Promise<unknown>;

const unavailableTransport: SubmissionTransport = async () => ({
  status: "unavailable",
});

/**
 * Validates both sides of the transport boundary. The default adapter performs
 * no network or persistence and can only return a non-success result.
 */
export async function submitMissingUniversity(
  submission: MissingUniversitySubmission,
  transport: SubmissionTransport = unavailableTransport,
): Promise<SubmissionResult> {
  const validatedSubmission = ValidatedMissingUniversitySubmissionSchema.parse(submission);

  try {
    return SubmissionResultSchema.parse(await transport(validatedSubmission));
  } catch {
    return { status: "unavailable" };
  }
}
