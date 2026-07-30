import { describe, expect, it, vi } from "vitest";

import { loadWatchlist } from "./watchlist-data";

const ownerId = "11111111-1111-4111-8111-111111111111";
const otherUserId = "22222222-2222-4222-8222-222222222222";
const programId = "33333333-3333-4333-8333-333333333333";
const intakeId = "44444444-4444-4444-8444-444444444444";
const windowId = "55555555-5555-4555-8555-555555555555";

function record(userId = ownerId, trackingStatus = "WATCHING") {
  return {
    id: crypto.randomUUID(),
    intakeId,
    program: {
      campus: "Singapore",
      degreeType: "MASTER",
      domains: [{ domain: { name: "Applied AI" } }],
      durationMonths: 12,
      id: programId,
      name: "MSc Responsible AI",
      university: {
        city: "Singapore",
        countryCode: "SG",
        id: "66666666-6666-4666-8666-666666666666",
        name: "Example University",
      },
    },
    programId,
    trackingStatus,
    userId,
    intake: {
      applicationWindows: [
        {
          closesAt: new Date("2027-02-01T00:00:00.000Z"),
          id: windowId,
          opensAt: new Date("2026-10-01T00:00:00.000Z"),
          publicStatus: "CONFIRMED",
          roundName: null,
          source: {
            isOfficial: true,
            programId,
            url: "https://example.edu/admissions",
          },
        },
      ],
      id: intakeId,
      month: 8,
      programId,
      year: 2027,
    },
  };
}

describe("authenticated home watchlist", () => {
  it("queries and presents only rows owned by the authenticated user", async () => {
    const findMany = vi.fn().mockResolvedValue([record(ownerId), record(otherUserId, "APPLIED")]);
    const client = {
      userWatchlist: {
        findMany,
      },
    };

    const result = await loadWatchlist(
      ownerId,
      client as never,
      new Date("2026-09-01T00:00:00.000Z"),
    );

    expect(result.watching).toHaveLength(1);
    expect(result.applied).toEqual([]);
    expect(result.watching[0]).toMatchObject({
      nextUsefulDate: "2026-10-01T00:00:00.000Z",
      program: {
        id: programId,
        intakeLabel: "August 2027",
        nextWindow: {
          id: windowId,
          officialSourceUrl: "https://example.edu/admissions",
        },
      },
    });
    expect(findMany.mock.calls[0]?.[0]).toMatchObject({
      where: {
        program: {
          status: "ACTIVE",
          university: {
            is: {
              status: "ACTIVE",
            },
          },
        },
        userId: ownerId,
      },
    });
  });

  it("uses a strict public-field selection and never exposes private ownership data", async () => {
    const findMany = vi.fn().mockResolvedValue([]);

    const result = await loadWatchlist(ownerId, { userWatchlist: { findMany } } as never);
    const serializedQuery = JSON.stringify(findMany.mock.calls[0]?.[0]);
    const serializedResult = JSON.stringify(result);

    expect(serializedQuery).not.toContain("privateNotes");
    expect(serializedQuery).not.toContain("email");
    expect(serializedQuery).not.toContain("verification");
    expect(serializedQuery).not.toContain("confidenceScore");
    expect(serializedResult).not.toContain(ownerId);
  });

  it("rejects mismatched intake/program rows instead of opening the wrong detail", async () => {
    const mismatched = record();
    mismatched.intake.programId = crypto.randomUUID();

    const result = await loadWatchlist(ownerId, {
      userWatchlist: { findMany: vi.fn().mockResolvedValue([mismatched]) },
    } as never);

    expect(result).toEqual({
      applied: [],
      openNow: [],
      watching: [],
    });
  });
});
