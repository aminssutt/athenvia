import { describe, expect, it } from "vitest";

import { mockProgramDetail, mockSearchResponse, mockWatchlistResponse } from "./mocks";
import {
  NotificationPayloadSchema,
  NotificationSettingsResponseSchema,
  ProgramDetailSchema,
  ProgramSummarySchema,
  ReminderPreferencesSchema,
  SearchErrorResponseSchema,
  SearchRequestSchema,
  SearchResponseSchema,
  WatchlistResponseSchema,
} from "./schemas";

describe("Athenvia contracts", () => {
  it("accepts the phase-zero mock search response", () => {
    expect(SearchResponseSchema.parse(mockSearchResponse)).toEqual(mockSearchResponse);
  });

  it("keeps sourced programme details separate from catalogue summaries", () => {
    expect(ProgramDetailSchema.parse(mockProgramDetail)).toEqual(mockProgramDetail);

    expect(ProgramSummarySchema.parse(mockProgramDetail)).toEqual(mockSearchResponse.programs[0]);
  });

  it("does not expose internal source or verification fields in programme details", () => {
    const detail = {
      ...mockProgramDetail,
      summary: {
        ...mockProgramDetail.summary,
        sourceId: "private-source-id",
        lastCheckedAt: "2026-07-30T13:36:05.893Z",
      },
      nextWindow: {
        ...mockProgramDetail.nextWindow!,
        verification: "OFFICIAL",
        confidenceScore: 1,
      },
    };

    expect(ProgramDetailSchema.parse(detail)).toEqual(mockProgramDetail);
  });

  it("requires concise HTTPS summary evidence without embedded credentials", () => {
    for (const officialSourceUrl of [
      "not-a-url",
      "javascript:alert(1)",
      "ftp://nus.edu.sg/programme",
      "https://user:secret@nus.edu.sg/programme",
    ]) {
      expect(
        ProgramDetailSchema.safeParse({
          ...mockProgramDetail,
          summary: {
            ...mockProgramDetail.summary,
            officialSourceUrl,
          },
        }).success,
      ).toBe(false);
    }
    expect(
      ProgramDetailSchema.safeParse({
        ...mockProgramDetail,
        summary: {
          ...mockProgramDetail.summary,
          text: "Too short.",
        },
      }).success,
    ).toBe(false);
  });

  it("normalizes and validates catalogue search input", () => {
    expect(
      SearchRequestSchema.parse({
        query: "  NUS  ",
        domain: "  entrepreneurship  ",
        cursor: "eyJvZmZzZXQiOjIwfQ",
      }),
    ).toEqual({
      query: "NUS",
      domain: "entrepreneurship",
      cursor: "eyJvZmZzZXQiOjIwfQ",
    });

    expect(SearchRequestSchema.safeParse({ query: "N" }).success).toBe(false);
    expect(SearchRequestSchema.safeParse({ query: "NUS", cursor: "x".repeat(257) }).success).toBe(
      false,
    );
  });

  it("documents structured search errors", () => {
    expect(
      SearchErrorResponseSchema.parse({
        error: {
          code: "RATE_LIMITED",
          message: "Too many searches. Please wait a moment and try again.",
          retryAfterSeconds: 30,
        },
      }),
    ).toEqual({
      error: {
        code: "RATE_LIMITED",
        message: "Too many searches. Please wait a moment and try again.",
        retryAfterSeconds: 30,
      },
    });
  });

  it("accepts the phase-zero mock watchlist response", () => {
    expect(WatchlistResponseSchema.parse(mockWatchlistResponse)).toEqual(mockWatchlistResponse);
  });

  it("rejects notification deep links outside the application", () => {
    const result = NotificationPayloadSchema.safeParse({
      type: "APPLICATION_OPENING",
      title: "Applications open soon",
      body: "Your expected opening date is approaching.",
      programId: "0f043d91-d700-4ee1-8f66-9a65c7e59301",
      watchlistId: "444ff389-c858-4a8d-8777-1da17276496d",
      deepLink: "https://example.com",
      dedupeKey: "opening:watchlist:30",
      scheduledFor: "2027-01-01T09:00:00.000Z",
      dateStatus: "EXPECTED",
    });

    expect(result.success).toBe(false);
  });

  it("accepts, sorts and validates the approved reminder offsets", () => {
    expect(
      ReminderPreferencesSchema.parse({
        dateChangeAlerts: true,
        deadlineReminderDays: [2, 30, 14],
        openingReminderDays: [0, 30],
      }),
    ).toEqual({
      dateChangeAlerts: true,
      deadlineReminderDays: [30, 14, 2],
      openingReminderDays: [30, 0],
    });

    expect(
      ReminderPreferencesSchema.safeParse({
        dateChangeAlerts: true,
        deadlineReminderDays: [30, 30],
        openingReminderDays: [30, 1],
      }).success,
    ).toBe(false);
  });

  it("keeps the notification settings response additive and count-safe", () => {
    expect(
      NotificationSettingsResponseSchema.safeParse({
        activePushSubscriptions: 1,
        dateChangeAlerts: true,
        deadlineReminderDays: [30, 14, 7, 2],
        deadlineReminders: true,
        openingReminderDays: [30, 7, 0],
        openingReminders: true,
        trackedPrograms: 2,
      }).success,
    ).toBe(true);
  });
});
