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
      deadlineReminders: false,
      openingReminders: true,
    };

    expect(notificationSettingsSchema.safeParse(valid).success).toBe(true);
    expect(
      notificationSettingsSchema.safeParse({ ...valid, pushEndpoint: "https://evil.example" })
        .success,
    ).toBe(false);
  });
});
