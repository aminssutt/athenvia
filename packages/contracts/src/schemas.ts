import { z } from "zod";

import {
  DegreeTypeSchema,
  NotificationTypeSchema,
  PublicDateStatusSchema,
  TrackingStatusSchema,
} from "./domain";

export const DEFAULT_OPENING_REMINDER_DAYS = [30, 7, 0] as const;
export const DEFAULT_DEADLINE_REMINDER_DAYS = [30, 14, 7, 2] as const;

export const OpeningReminderDaySchema = z.union([z.literal(30), z.literal(7), z.literal(0)]);
export const DeadlineReminderDaySchema = z.union([
  z.literal(30),
  z.literal(14),
  z.literal(7),
  z.literal(2),
]);

function canonicalReminderDays<T extends number>(
  daySchema: z.ZodType<T>,
  orderedDays: readonly T[],
) {
  return z
    .array(daySchema)
    .max(orderedDays.length)
    .superRefine((days, context) => {
      if (new Set(days).size !== days.length) {
        context.addIssue({
          code: "custom",
          message: "Reminder offsets must be unique.",
        });
      }
    })
    .transform((days) => orderedDays.filter((day) => days.includes(day)));
}

export const OpeningReminderDaysSchema = canonicalReminderDays(
  OpeningReminderDaySchema,
  DEFAULT_OPENING_REMINDER_DAYS,
);
export const DeadlineReminderDaysSchema = canonicalReminderDays(
  DeadlineReminderDaySchema,
  DEFAULT_DEADLINE_REMINDER_DAYS,
);

export const ReminderPreferencesSchema = z
  .object({
    dateChangeAlerts: z.boolean(),
    deadlineReminderDays: DeadlineReminderDaysSchema,
    openingReminderDays: OpeningReminderDaysSchema,
  })
  .strict();

export const NotificationSettingsResponseSchema = ReminderPreferencesSchema.extend({
  activePushSubscriptions: z.number().int().nonnegative(),
  deadlineReminders: z.boolean(),
  openingReminders: z.boolean(),
  trackedPrograms: z.number().int().nonnegative(),
});

export const UniversitySummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  countryCode: z.string().length(2),
  city: z.string().nullable(),
  logoUrl: z.string().url().nullable(),
});

export const ApplicationWindowSchema = z.object({
  id: z.string().uuid(),
  roundName: z.string().nullable(),
  opensAt: z.iso.datetime().nullable(),
  closesAt: z.iso.datetime().nullable(),
  publicStatus: PublicDateStatusSchema,
  officialSourceUrl: z.string().url().nullable(),
});

export const ProgramSummarySchema = z.object({
  id: z.string().uuid(),
  university: UniversitySummarySchema,
  name: z.string().min(1),
  degreeType: DegreeTypeSchema,
  domains: z.array(z.string().min(1)),
  location: z.string().nullable(),
  durationMonths: z.number().int().positive().nullable(),
  intakeLabel: z.string().min(1),
  nextWindow: ApplicationWindowSchema.nullable(),
});

export const SearchRequestSchema = z.object({
  query: z.string().trim().min(2).max(120),
  domain: z.string().trim().min(1).max(80).optional(),
  cursor: z.string().trim().min(1).max(256).optional(),
});

export const SearchResponseSchema = z.object({
  programs: z.array(ProgramSummarySchema),
  nextCursor: z.string().nullable(),
});

export const SearchErrorCodeSchema = z.enum([
  "INVALID_REQUEST",
  "INVALID_CURSOR",
  "RATE_LIMITED",
  "SEARCH_UNAVAILABLE",
]);

export const SearchErrorResponseSchema = z.object({
  error: z.object({
    code: SearchErrorCodeSchema,
    message: z.string().min(1),
    issues: z
      .array(
        z.object({
          path: z.array(z.union([z.string(), z.number()])),
          message: z.string().min(1),
        }),
      )
      .optional(),
    retryAfterSeconds: z.number().int().positive().optional(),
  }),
});

export const WatchlistItemSchema = z.object({
  id: z.string().uuid(),
  trackingStatus: TrackingStatusSchema,
  program: ProgramSummarySchema,
  nextUsefulDate: z.iso.datetime().nullable(),
});

export const WatchlistResponseSchema = z.object({
  watching: z.array(WatchlistItemSchema),
  openNow: z.array(WatchlistItemSchema),
  applied: z.array(WatchlistItemSchema),
});

export const FollowProgramRequestSchema = z.object({
  programId: z.string().uuid(),
  intakeId: z.string().uuid(),
});

export const NotificationPayloadSchema = z.object({
  type: NotificationTypeSchema,
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(240),
  programId: z.string().uuid(),
  watchlistId: z.string().uuid(),
  deepLink: z.string().startsWith("/"),
  dedupeKey: z.string().min(8).max(255),
  scheduledFor: z.iso.datetime(),
  dateStatus: PublicDateStatusSchema,
});

export type UniversitySummary = z.infer<typeof UniversitySummarySchema>;
export type ProgramSummary = z.infer<typeof ProgramSummarySchema>;
export type SearchRequest = z.infer<typeof SearchRequestSchema>;
export type SearchResponse = z.infer<typeof SearchResponseSchema>;
export type SearchErrorCode = z.infer<typeof SearchErrorCodeSchema>;
export type SearchErrorResponse = z.infer<typeof SearchErrorResponseSchema>;
export type WatchlistItem = z.infer<typeof WatchlistItemSchema>;
export type WatchlistResponse = z.infer<typeof WatchlistResponseSchema>;
export type FollowProgramRequest = z.infer<typeof FollowProgramRequestSchema>;
export type NotificationPayload = z.infer<typeof NotificationPayloadSchema>;
export type OpeningReminderDay = z.infer<typeof OpeningReminderDaySchema>;
export type DeadlineReminderDay = z.infer<typeof DeadlineReminderDaySchema>;
export type ReminderPreferences = z.infer<typeof ReminderPreferencesSchema>;
export type NotificationSettingsResponse = z.infer<typeof NotificationSettingsResponseSchema>;
