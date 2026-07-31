import { describe, expect, it, vi } from "vitest";

import { checkWorkerHeartbeat, WORKER_HEARTBEAT_KEY } from "./check";

describe("worker heartbeat health", () => {
  const now = new Date("2026-07-31T10:00:00.000Z");

  it("accepts a recent heartbeat", async () => {
    const readHeartbeat = vi.fn().mockResolvedValue("2026-07-31T09:59:30.000Z");
    await expect(checkWorkerHeartbeat(readHeartbeat, now)).resolves.toBeUndefined();
    expect(readHeartbeat).toHaveBeenCalledWith(WORKER_HEARTBEAT_KEY);
  });

  it.each([null, "invalid", "2026-07-31T09:58:29.000Z", "2026-07-31T10:00:01.000Z"])(
    "rejects an absent, malformed, stale, or future heartbeat (%s)",
    async (heartbeat) => {
      await expect(checkWorkerHeartbeat(vi.fn().mockResolvedValue(heartbeat), now)).rejects.toThrow(
        "heartbeat is unavailable",
      );
    },
  );
});
