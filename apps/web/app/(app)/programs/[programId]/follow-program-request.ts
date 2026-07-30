import { z } from "zod";

const FollowSuccessSchema = z.object({
  watchlist: z.object({
    id: z.string().uuid(),
    intakeId: z.string().uuid(),
    programId: z.string().uuid(),
  }),
});

export type FollowRequestErrorCode = "AUTH_REQUIRED" | "FOLLOW_UNAVAILABLE";

export class FollowRequestError extends Error {
  constructor(readonly code: FollowRequestErrorCode) {
    super(code);
    this.name = "FollowRequestError";
  }
}

export type FollowResult = {
  intakeId: string;
  programId: string;
  watchlistId: string;
};

type FetchFollow = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Pick<Response, "json" | "ok" | "status">>;

export async function requestProgramFollow(
  programId: string,
  intakeId: string,
  fetchFollow: FetchFollow = fetch,
): Promise<FollowResult> {
  const response = await fetchFollow("/api/watchlist", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ programId, intakeId }),
  });

  if (response.status === 401) {
    throw new FollowRequestError("AUTH_REQUIRED");
  }
  if (!response.ok) {
    throw new FollowRequestError("FOLLOW_UNAVAILABLE");
  }

  const parsed = FollowSuccessSchema.safeParse(await response.json());
  if (
    !parsed.success ||
    parsed.data.watchlist.programId !== programId ||
    parsed.data.watchlist.intakeId !== intakeId
  ) {
    throw new FollowRequestError("FOLLOW_UNAVAILABLE");
  }

  return {
    intakeId,
    programId,
    watchlistId: parsed.data.watchlist.id,
  };
}
