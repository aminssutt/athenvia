import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
}));

vi.mock("@athenvia/database", () => ({
  database: {
    notificationDelivery: {
      findMany: mocks.findMany,
    },
  },
}));

import { loadNotificationHistory } from "./history";

const ownerId = "11111111-1111-4111-8111-111111111111";
const programId = "22222222-2222-4222-8222-222222222222";

describe("notification history query", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("enforces delivery and watchlist ownership while selecting only terminal user fields", async () => {
    mocks.findMany.mockResolvedValue([]);

    await loadNotificationHistory(ownerId);

    expect(mocks.findMany).toHaveBeenCalledWith({
      where: {
        status: {
          in: ["SENT", "FAILED"],
        },
        userId: ownerId,
        watchlist: {
          is: {
            userId: ownerId,
          },
        },
      },
      orderBy: [{ scheduledFor: "desc" }, { id: "desc" }],
      take: 50,
      select: {
        id: true,
        notificationType: true,
        scheduledFor: true,
        sentAt: true,
        status: true,
        watchlist: {
          select: {
            program: {
              select: {
                id: true,
                name: true,
                university: {
                  select: {
                    name: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    const query = mocks.findMany.mock.calls[0]?.[0];
    expect(JSON.stringify(query)).not.toContain("errorMessage");
    expect(JSON.stringify(query)).not.toContain("dedupeKey");
    expect(JSON.stringify(query)).not.toContain("privateNotes");
  });

  it.each([
    ["APPLICATION_OPENING", "Applications opening"],
    ["APPLICATION_DEADLINE", "Application deadline"],
    ["DATE_CHANGED", "Application date updated"],
    ["SUBMISSION_APPROVED", "Submission approved"],
  ] as const)("maps %s to safe copy and the canonical program link", async (type, title) => {
    mocks.findMany.mockResolvedValue([
      {
        dedupeKey: "internal:dedupe:must-not-leak",
        errorMessage: "transport secret must not leak",
        id: "33333333-3333-4333-8333-333333333333",
        notificationType: type,
        scheduledFor: new Date("2026-08-01T09:00:00.000Z"),
        sentAt: new Date("2026-08-01T09:00:02.000Z"),
        status: "SENT",
        watchlist: {
          privateNotes: "private notes must not leak",
          program: {
            id: programId,
            name: "MSc Responsible AI",
            university: {
              name: "Example University",
            },
          },
        },
      },
    ]);

    const result = await loadNotificationHistory(ownerId);
    const serialized = JSON.stringify(result);

    expect(result).toEqual([
      {
        description: expect.any(String),
        href: `/programs/${programId}`,
        id: "33333333-3333-4333-8333-333333333333",
        notificationType: type,
        program: {
          id: programId,
          name: "MSc Responsible AI",
          universityName: "Example University",
        },
        scheduledFor: "2026-08-01T09:00:00.000Z",
        sentAt: "2026-08-01T09:00:02.000Z",
        status: "SENT",
        title,
      },
    ]);
    expect(serialized).not.toContain("internal:dedupe");
    expect(serialized).not.toContain("transport secret");
    expect(serialized).not.toContain("private notes");
  });
});
