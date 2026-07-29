import { WatchlistResponseSchema } from "@athenvia/contracts";
import { mockWatchlistResponse } from "@athenvia/contracts/mocks";

import type { WatchlistResponse } from "@athenvia/contracts";

export type WatchlistLoader = () => Promise<unknown>;

const loadMockWatchlist: WatchlistLoader = async () => mockWatchlistResponse;

/**
 * Keeps the route independent from its transport. Replace the default loader
 * with an authenticated API adapter when the watchlist endpoint is available.
 */
export async function loadWatchlist(
  loader: WatchlistLoader = loadMockWatchlist,
): Promise<WatchlistResponse> {
  return WatchlistResponseSchema.parse(await loader());
}
