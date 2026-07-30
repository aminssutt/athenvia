import { DegreeTypeSchema } from "@athenvia/contracts";
import { z } from "zod";

export const approvedDomains = [
  "Entrepreneurship",
  "Artificial intelligence",
  "Robotics",
  "Computer science",
  "Management",
  "Other",
] as const;

export const degreeOptions = [
  { label: "Master", value: "MASTER" },
  { label: "MBA", value: "MBA" },
  { label: "PhD", value: "PHD" },
  { label: "Other degree", value: "OTHER" },
] as const;

export const UniversityContextSchema = z.object({
  universityId: z.string().uuid(),
  universityName: z.string().trim().min(2).max(120),
});

const UniversityIdSchema = z.string().uuid("Choose a university from search.");
const UniversityNameSchema = z.string().trim().min(2).max(120);
const ProgramNameSchema = z
  .string()
  .trim()
  .min(2, "Enter the program name.")
  .max(160, "Keep the program name under 160 characters.");
const DegreeSelectionSchema = z.enum(DegreeTypeSchema.options, {
  error: "Choose a degree.",
});
const DomainSchema = z.enum(approvedDomains, {
  error: "Choose a domain.",
});

function isSafeOfficialUrl(value: string): boolean {
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

export const MissingProgramSubmissionSchema = z.object({
  universityId: UniversityIdSchema,
  universityName: UniversityNameSchema,
  programName: ProgramNameSchema,
  degreeType: DegreeSelectionSchema,
  domain: DomainSchema,
  officialUrl: z
    .string()
    .trim()
    .max(2_048, "Keep the website address under 2,048 characters.")
    .refine(isSafeOfficialUrl, "Enter a full URL starting with https:// or http://.")
    .transform((value) => (value ? new URL(value).toString() : null)),
});

const ValidatedMissingProgramSubmissionSchema = z.object({
  universityId: UniversityIdSchema,
  universityName: UniversityNameSchema,
  programName: ProgramNameSchema,
  degreeType: DegreeSelectionSchema,
  domain: DomainSchema,
  officialUrl: z.string().url().refine(isSafeOfficialUrl).nullable(),
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

export type UniversityContext = z.infer<typeof UniversityContextSchema>;
export type MissingProgramSubmission = z.output<typeof MissingProgramSubmissionSchema>;
export type SubmissionResult = z.infer<typeof SubmissionResultSchema>;
export type SubmissionTransport = (submission: MissingProgramSubmission) => Promise<unknown>;

const unavailableTransport: SubmissionTransport = async () => ({
  status: "unavailable",
});

/**
 * Validates both sides of the future API boundary. The default adapter performs
 * no network or persistence and cannot return a success result.
 */
export async function submitMissingProgram(
  submission: MissingProgramSubmission,
  transport: SubmissionTransport = unavailableTransport,
): Promise<SubmissionResult> {
  const validatedSubmission = ValidatedMissingProgramSubmissionSchema.parse(submission);

  try {
    return SubmissionResultSchema.parse(await transport(validatedSubmission));
  } catch {
    return { status: "unavailable" };
  }
}
