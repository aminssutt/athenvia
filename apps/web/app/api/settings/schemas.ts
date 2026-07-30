import { z } from "zod";

import {
  DEFAULT_DEADLINE_REMINDER_DAYS,
  DEFAULT_OPENING_REMINDER_DAYS,
  ReminderPreferencesSchema,
} from "@athenvia/contracts";

const legacyNotificationSettingsSchema = z
  .object({
    dateChangeAlerts: z.boolean(),
    deadlineReminders: z.boolean(),
    openingReminders: z.boolean(),
  })
  .strict()
  .transform((settings) => ({
    dateChangeAlerts: settings.dateChangeAlerts,
    deadlineReminderDays: settings.deadlineReminders ? [...DEFAULT_DEADLINE_REMINDER_DAYS] : [],
    openingReminderDays: settings.openingReminders ? [...DEFAULT_OPENING_REMINDER_DAYS] : [],
  }));

export const notificationSettingsSchema = z.union([
  ReminderPreferencesSchema,
  legacyNotificationSettingsSchema,
]);

export const deleteAccountSchema = z
  .object({
    confirmation: z.literal("DELETE"),
  })
  .strict();

export type NotificationSettingsInput = z.infer<typeof notificationSettingsSchema>;
