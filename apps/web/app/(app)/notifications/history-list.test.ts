import { describe, expect, it } from "vitest";

import { notificationHistoryEmptyCopy, presentNotificationHistory } from "./history-presentation";

import type { NotificationHistoryItem } from "@/app/api/notifications/history";

const items: NotificationHistoryItem[] = [
  {
    description: "A reminder that an application period is opening.",
    href: "/programs/22222222-2222-4222-8222-222222222222",
    id: "33333333-3333-4333-8333-333333333333",
    notificationType: "APPLICATION_OPENING",
    program: {
      id: "22222222-2222-4222-8222-222222222222",
      name: "MSc Responsible AI",
      universityName: "Example University",
    },
    scheduledFor: "2026-08-01T09:00:00.000Z",
    sentAt: "2026-08-01T09:00:02.000Z",
    status: "SENT",
    title: "Applications opening",
  },
  {
    description: "A reminder about an upcoming application deadline.",
    href: "/programs/44444444-4444-4444-8444-444444444444",
    id: "55555555-5555-4555-8555-555555555555",
    notificationType: "APPLICATION_DEADLINE",
    program: {
      id: "44444444-4444-4444-8444-444444444444",
      name: "Master in Public Policy",
      universityName: "Another University",
    },
    scheduledFor: "2026-08-02T10:00:00.000Z",
    sentAt: null,
    status: "FAILED",
    title: "Application deadline",
  },
];

describe("notification history presentation", () => {
  it("presents sent and failed entries with their canonical program links", () => {
    const presented = presentNotificationHistory(items);

    expect(presented[0]).toMatchObject({
      href: "/programs/22222222-2222-4222-8222-222222222222",
      statusLabel: "Sent",
      timestampLabel: "Sent",
      timestampValue: "2026-08-01T09:00:02.000Z",
    });
    expect(presented[1]).toMatchObject({
      href: "/programs/44444444-4444-4444-8444-444444444444",
      statusLabel: "Delivery failed",
      timestampLabel: "Scheduled for",
      timestampValue: "2026-08-02T10:00:00.000Z",
    });
  });

  it("provides a useful empty state", () => {
    expect(presentNotificationHistory([])).toEqual([]);
    expect(notificationHistoryEmptyCopy).toEqual({
      action: "View your programs",
      description: "Sent reminders and delivery issues will appear here.",
      title: "No notifications yet",
    });
  });
});
