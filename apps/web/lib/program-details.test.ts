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
