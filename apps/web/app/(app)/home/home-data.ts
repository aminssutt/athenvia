import type { AuthenticatedUser } from "@/app/api/settings/authenticated-user";
import type { WatchlistResponse } from "@athenvia/contracts";

import { loadWatchlist } from "./watchlist-data";

export type HomeWatchlistLoader = (userId: string) => Promise<WatchlistResponse>;

export async function loadAuthenticatedHomeWatchlist(
  user: AuthenticatedUser | null,
  loader: HomeWatchlistLoader = loadWatchlist,
): Promise<WatchlistResponse | null> {
  return user ? loader(user.id) : null;
}
