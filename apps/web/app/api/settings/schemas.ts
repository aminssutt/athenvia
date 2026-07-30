import { z } from "zod";

export const notificationSettingsSchema = z
  .object({
    dateChangeAlerts: z.boolean(),
    deadlineReminders: z.boolean(),
    openingReminders: z.boolean(),
  })
  .strict();

export const deleteAccountSchema = z
  .object({
    confirmation: z.literal("DELETE"),
  })
  .strict();

export type NotificationSettingsInput = z.infer<typeof notificationSettingsSchema>;
