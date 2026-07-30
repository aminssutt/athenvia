import { describe, expect, it } from "vitest";

import { deleteAccountSchema, notificationSettingsSchema } from "./schemas";

describe("settings payload validation", () => {
  it("requires the exact destructive confirmation", () => {
    expect(deleteAccountSchema.safeParse({ confirmation: "DELETE" }).success).toBe(true);
    expect(deleteAccountSchema.safeParse({ confirmation: "delete" }).success).toBe(false);
    expect(
      deleteAccountSchema.safeParse({ confirmation: "DELETE", userId: "someone-else" }).success,
    ).toBe(false);
  });

  it("accepts only the supported notification switches", () => {
    const valid = {
      dateChangeAlerts: true,
      deadlineReminderDays: [30, 7],
      openingReminderDays: [7, 0],
    };

    expect(notificationSettingsSchema.safeParse(valid).success).toBe(true);
    expect(
      notificationSettingsSchema.safeParse({ ...valid, pushEndpoint: "https://evil.example" })
        .success,
    ).toBe(false);
    expect(
      notificationSettingsSchema.safeParse({
        ...valid,
        openingReminderDays: [7, 1],
      }).success,
    ).toBe(false);
  });

  it("normalizes the legacy switches without keeping partially enabled rows", () => {
    expect(
      notificationSettingsSchema.parse({
        dateChangeAlerts: false,
        deadlineReminders: false,
        openingReminders: false,
      }),
    ).toEqual({
      dateChangeAlerts: false,
      deadlineReminderDays: [],
      openingReminderDays: [],
    });
  });
});
