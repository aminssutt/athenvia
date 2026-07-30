import { z } from "zod";

const UniversityNameSchema = z
  .string()
  .trim()
  .min(2)
  .max(120)
  .refine((value) => /\p{L}/u.test(value), "Enter a university name.")
  .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value), "Control characters are not allowed.")
  .transform((value) => value.replace(/\s+/g, " "));

const CountryNameSchema = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .refine((value) => /\p{L}/u.test(value), "Enter a country name.")
  .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value), "Control characters are not allowed.")
  .transform((value) => value.replace(/\s+/g, " "));

export const UniversitySubmissionRequestSchema = z
  .object({
    universityName: UniversityNameSchema,
    country: CountryNameSchema,
    officialWebsite: z
      .union([z.string().trim().max(2_048), z.null()])
      .optional()
      .transform((value) => value || null),
  })
  .strict();

export type UniversitySubmissionRequest = z.output<typeof UniversitySubmissionRequestSchema>;
