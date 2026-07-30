import { describe, expect, it, vi } from "vitest";

import { mockProgram, mockProgramDetail } from "@athenvia/contracts/mocks";

import { loadProgram } from "./program-data";

describe("live programme page data", () => {
  it("accepts a source-backed live programme detail", async () => {
    const loader = vi.fn().mockResolvedValue(mockProgramDetail);

    await expect(loadProgram(mockProgramDetail.id, loader)).resolves.toEqual(mockProgramDetail);
    expect(loader).toHaveBeenCalledWith(mockProgramDetail.id);
  });

  it("preserves not-found without falling back to the phase-zero mock", async () => {
    const loader = vi.fn().mockResolvedValue(null);

    await expect(loadProgram(crypto.randomUUID(), loader)).resolves.toBeNull();
  });

  it("rejects catalogue cards that do not satisfy the detail contract", async () => {
    await expect(loadProgram(mockProgram.id, async () => mockProgram)).rejects.toThrow();
  });
});
