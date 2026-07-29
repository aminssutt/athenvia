import { describe, expect, it } from "vitest";

import { mockSearchResponse, mockWatchlistResponse } from "./mocks";
import {
  NotificationPayloadSchema,
  SearchResponseSchema,
  WatchlistResponseSchema,
} from "./schemas";

describe("Athenvia contracts", () => {
  it("accepts the phase-zero mock search response", () => {
    expect(SearchResponseSchema.parse(mockSearchResponse)).toEqual(mockSearchResponse);
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
});
