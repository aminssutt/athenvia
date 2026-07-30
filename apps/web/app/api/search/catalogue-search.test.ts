import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  queryRaw: vi.fn(),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings: [...strings],
    values,
  })),
}));

vi.mock("@athenvia/database", () => ({
  database: {
    $queryRaw: mocks.queryRaw,
    program: {
      findMany: mocks.findMany,
    },
  },
  Prisma: {
    sql: mocks.sql,
  },
}));

import { searchCatalogue } from "./catalogue-search";

const programId = "11111111-1111-4111-8111-111111111111";

describe("live catalogue search presentation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps the real programme ID and uses the exact application-window source", async () => {
    mocks.queryRaw.mockResolvedValue([{ id: programId, relevance: 1 }]);
    mocks.findMany.mockResolvedValue([
      {
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
            month: 8,
            year: 2027,
          },
        ],
        name: "MSc Responsible AI",
        university: {
          city: "Singapore",
          countryCode: "SG",
          id: "33333333-3333-4333-8333-333333333333",
          name: "Example University",
        },
      },
    ]);

    const result = await searchCatalogue({ query: "Responsible AI" }, 0);

    expect(result.programs[0]).toMatchObject({
      id: programId,
      nextWindow: {
        officialSourceUrl: "https://example.edu/admissions",
      },
    });
    expect(mocks.findMany.mock.calls[0]?.[0]).not.toHaveProperty("include.sources");
    const sqlText = mocks.sql.mock.calls[0]?.[0].join(" ");
    expect(sqlText).toContain("program_summaries");
    expect(sqlText).toContain("summary_source.is_official = TRUE");
  });
});
