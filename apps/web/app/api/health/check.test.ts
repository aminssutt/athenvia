import { describe, expect, it, vi } from "vitest";

import { checkHealth } from "./check";

describe("checkHealth", () => {
  it("resolves when PostgreSQL and Redis are available", async () => {
    const checkDatabase = vi.fn().mockResolvedValue(undefined);
    const checkRedis = vi.fn().mockResolvedValue(undefined);

    await expect(checkHealth({ checkDatabase, checkRedis }, 50)).resolves.toBeUndefined();
    expect(checkDatabase).toHaveBeenCalledOnce();
    expect(checkRedis).toHaveBeenCalledOnce();
  });

  it("rejects when a dependency is unavailable", async () => {
    const checkDatabase = vi.fn().mockRejectedValue(new Error("database unavailable"));
    const checkRedis = vi.fn().mockResolvedValue(undefined);

    await expect(checkHealth({ checkDatabase, checkRedis }, 50)).rejects.toThrow(
      "database unavailable",
    );
  });

  it("rejects when dependency checks exceed the deadline", async () => {
    const never = () => new Promise<never>(() => {});

    await expect(checkHealth({ checkDatabase: never, checkRedis: never }, 10)).rejects.toThrow(
      "Health check timed out",
    );
  });
});
