import { z } from "zod";

export const approvedProgramDomains = [
  "Entrepreneurship",
  "Artificial intelligence",
  "Robotics",
  "Computer science",
  "Management",
  "Other",
] as const;

function cleanText(maximumLength: number) {
  return z
    .string()
    .trim()
    .min(2)
    .max(maximumLength)
    .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value), "Control characters are not allowed.")
    .transform((value) => value.replace(/\s+/gu, " "));
}

function normalizedHttpUrl(value: string): string | null {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      !url.hostname ||
      url.username ||
      url.password
    ) {
      return null;
    }

    const normalized = url.toString();
    return normalized.length <= 2_048 ? normalized : null;
  } catch {
    return null;
  }
}

const OfficialUrlSchema = z
  .union([z.string().trim().max(2_048), z.null()])
  .optional()
  .refine(
    (value) =>
      value === undefined || value === null || value === "" || normalizedHttpUrl(value) !== null,
    {
      message: "Use a complete HTTP or HTTPS URL without embedded credentials.",
    },
  )
  .transform((value) => (typeof value === "string" ? normalizedHttpUrl(value) : null));

export const ProgramSubmissionRequestSchema = z
  .object({
    universityId: z.string().uuid(),
    universityName: cleanText(120),
    programName: cleanText(160),
    degreeType: z.enum(["MASTER", "MBA", "PHD", "OTHER"]),
    domain: z.enum(approvedProgramDomains),
    officialUrl: OfficialUrlSchema,
  })
  .strict();

export type ProgramSubmissionRequest = z.output<typeof ProgramSubmissionRequestSchema>;
