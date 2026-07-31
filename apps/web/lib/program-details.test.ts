import { describe, expect, it, vi } from "vitest";

import { findPublicProgramDetail, presentProgramDetail } from "./program-details";

const programId = "11111111-1111-4111-8111-111111111111";

function record() {
  return {
    campus: "Singapore",
    degreeType: "MASTER",
    domains: [{ domain: { name: "Applied AI" } }],
    durationMonths: 12,
    id: programId,
    intakes: [
      {
        applicationWindows: [
          {
            closesAt: null,
            id: "22222222-2222-4222-8222-222222222222",
            opensAt: null,
            publicStatus: "NOT_PUBLISHED",
            roundName: null,
            source: {
              isOfficial: true,
              programId,
              url: "https://example.edu/admissions",
            },
          },
        ],
        id: "33333333-3333-4333-8333-333333333333",
        month: 8,
        year: 2027,
      },
    ],
    name: "MSc Responsible AI",
    summary: {
      source: {
        isOfficial: true,
        programId,
        url: "https://example.edu/programme",
      },
      text: "A source-backed graduate programme that combines responsible artificial intelligence, applied coursework and multidisciplinary project experience.",
    },
    university: {
      city: "Singapore",
      countryCode: "SG",
      id: "44444444-4444-4444-8444-444444444444",
      name: "Example University",
    },
  };
}

describe("public programme detail service", () => {
  it("skips an intake whose deadlines have all passed", () => {
    const now = new Date("2026-07-31T18:00:00.000Z");
    const withClosedCycle = record();
    const upcoming = structuredClone(withClosedCycle.intakes[0]);
    withClosedCycle.intakes[0]!.year = 2026;
    withClosedCycle.intakes[0]!.month = 9;
    withClosedCycle.intakes[0]!.applicationWindows[0]!.closesAt = new Date(
      "2026-04-30T04:00:00.000Z",
    ) as never;
    withClosedCycle.intakes[0]!.applicationWindows[0]!.publicStatus = "CONFIRMED";
    withClosedCycle.intakes.push(upcoming);

    const detail = presentProgramDetail(withClosedCycle as never, now);

    // The expired cycle must not be presented as the next deadline.
    expect(detail?.intakeLabel).toBe("August 2027");
    expect(detail?.nextWindow?.closesAt ?? null).toBeNull();
  });

  it("prefers the first deadline that has not passed within an intake", () => {
    const now = new Date("2026-07-31T18:00:00.000Z");
    const multiRound = record();
    const passedRound = structuredClone(multiRound.intakes[0]!.applicationWindows[0]!);
    passedRound.id = "44444444-4444-4444-8444-444444444444";
    passedRound.closesAt = new Date("2026-01-05T22:00:00.000Z") as never;
    passedRound.publicStatus = "CONFIRMED";
    const openRound = multiRound.intakes[0]!.applicationWindows[0]!;
    openRound.closesAt = new Date("2027-01-05T22:00:00.000Z") as never;
    openRound.publicStatus = "CONFIRMED";
    multiRound.intakes[0]!.applicationWindows = [passedRound, openRound];

    const detail = presentProgramDetail(multiRound as never, now);

    expect(detail?.nextWindow?.closesAt).toBe("2027-01-05T22:00:00.000Z");
  });

  it("maps only the public sourced detail fields", () => {
    const detail = presentProgramDetail(record() as never);

    expect(detail).toMatchObject({
      id: programId,
      intakeLabel: "August 2027",
      nextWindow: {
        officialSourceUrl: "https://example.edu/admissions",
      },
      summary: {
        officialSourceUrl: "https://example.edu/programme",
      },
    });
    const serialized = JSON.stringify(detail);
    expect(serialized).not.toContain("isOfficial");
    expect(serialized).not.toContain("programId");
    expect(serialized).not.toContain("verification");
    expect(serialized).not.toContain("lastVerifiedAt");
  });

  it("rejects unsafe or cross-program summary evidence", () => {
    const crossProgram = record();
    crossProgram.summary.source.programId = crypto.randomUUID();
    expect(presentProgramDetail(crossProgram as never)).toBeNull();

    const credentialed = record();
    credentialed.summary.source.url = "https://user:secret@example.edu/programme";
    expect(presentProgramDetail(credentialed as never)).toBeNull();
  });

  it("queries only active, sourced programmes with at least one intake", async () => {
    const findFirst = vi.fn().mockResolvedValue(record());

    const result = await findPublicProgramDetail(programId, { program: { findFirst } } as never);

    expect(result?.id).toBe(programId);
    expect(findFirst.mock.calls[0]?.[0]).toMatchObject({
      where: {
        id: programId,
        intakes: { some: {} },
        status: "ACTIVE",
        summary: {
          is: {
            source: {
              is: {
                isOfficial: true,
              },
            },
          },
        },
        university: {
          is: {
            status: "ACTIVE",
          },
        },
      },
    });
  });

  it("preserves not-found for live IDs instead of falling back to mocks", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);

    await expect(
      findPublicProgramDetail(programId, { program: { findFirst } } as never),
    ).resolves.toBeNull();
  });
});
