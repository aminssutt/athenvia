import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings: [...strings],
    values,
  })),
}));

vi.mock("@athenvia/database", () => ({
  database: {
    $queryRaw: mocks.queryRaw,
  },
  Prisma: {
    sql: mocks.sql,
  },
}));

import { searchUniversities } from "./university-search";

const universityId = "33333333-3333-4333-8333-333333333333";

function rankedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: universityId,
    name: "Massachusetts Institute of Technology",
    country_code: "US",
    city: "Cambridge",
    official_website: "https://web.mit.edu",
    program_count: 2,
    relevance: 1.5,
    ...overrides,
  };
}

describe("university search presentation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps ranked rows to the public university result shape", async () => {
    mocks.queryRaw.mockResolvedValue([rankedRow()]);

    const results = await searchUniversities("mit");

    expect(results).toEqual([
      {
        id: universityId,
        name: "Massachusetts Institute of Technology",
        countryCode: "US",
        city: "Cambridge",
        officialWebsite: "https://web.mit.edu",
        programCount: 2,
      },
    ]);
  });

  it("passes the raw query to the database exactly once", async () => {
    mocks.queryRaw.mockResolvedValue([]);

    await searchUniversities("école polytechnique");

    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
    const statement = mocks.queryRaw.mock.calls[0]![0] as { values: unknown[] };
    expect(statement.values).toContain("école polytechnique");
  });

  it("degrades a malformed stored website to null instead of failing", async () => {
    mocks.queryRaw.mockResolvedValue([rankedRow({ official_website: "not a url" })]);

    const results = await searchUniversities("mit");

    expect(results[0]!.officialWebsite).toBeNull();
  });

  it("keeps universities without any tracked programs visible", async () => {
    mocks.queryRaw.mockResolvedValue([rankedRow({ program_count: 0, official_website: null })]);

    const results = await searchUniversities("mit");

    expect(results[0]!.programCount).toBe(0);
    expect(results[0]!.officialWebsite).toBeNull();
  });
});
