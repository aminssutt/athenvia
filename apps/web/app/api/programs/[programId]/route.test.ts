import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockProgramDetail } from "@athenvia/contracts/mocks";

const mocks = vi.hoisted(() => ({
  findPublicProgramDetail: vi.fn(),
}));

vi.mock("@/lib/program-details", () => ({
  findPublicProgramDetail: mocks.findPublicProgramDetail,
}));

import { GET } from "./route";

const programId = mockProgramDetail.id;

function context(id = programId) {
  return {
    params: Promise.resolve({ programId: id }),
  };
}

describe("GET /api/programs/:programId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects malformed identifiers before querying the catalogue", async () => {
    const response = await GET(new Request("https://athenvia.test"), context("not-a-uuid"));

    expect(response.status).toBe(400);
    expect(mocks.findPublicProgramDetail).not.toHaveBeenCalled();
  });

  it("returns the source-backed public detail contract", async () => {
    mocks.findPublicProgramDetail.mockResolvedValue(mockProgramDetail);

    const response = await GET(new Request("https://athenvia.test"), context());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual(mockProgramDetail);
    expect(mocks.findPublicProgramDetail).toHaveBeenCalledWith(programId);
  });

  it("does not expose inactive, incomplete or unknown programmes", async () => {
    mocks.findPublicProgramDetail.mockResolvedValue(null);

    const response = await GET(new Request("https://athenvia.test"), context());

    expect(response.status).toBe(404);
  });

  it("returns a safe unavailable response when the catalogue query fails", async () => {
    mocks.findPublicProgramDetail.mockRejectedValue(new Error("database details"));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await GET(new Request("https://athenvia.test"), context());

    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("database details");
    error.mockRestore();
  });
});
