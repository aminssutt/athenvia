import { describe, expect, it, vi } from "vitest";

import { loadAuthenticatedHomeWatchlist } from "./home-data";

describe("home authentication boundary", () => {
  it("does not query private watchlists for anonymous visitors", async () => {
    const loader = vi.fn();

    await expect(loadAuthenticatedHomeWatchlist(null, loader)).resolves.toBeNull();
    expect(loader).not.toHaveBeenCalled();
  });

  it("passes only the authenticated owner ID to the watchlist loader", async () => {
    const user = {
      email: "owner@example.test",
      id: "11111111-1111-4111-8111-111111111111",
    };
    const watchlist = {
      applied: [],
      openNow: [],
      watching: [],
    };
    const loader = vi.fn().mockResolvedValue(watchlist);

    await expect(loadAuthenticatedHomeWatchlist(user, loader)).resolves.toEqual(watchlist);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(loader).toHaveBeenCalledWith(user.id);
  });
});
