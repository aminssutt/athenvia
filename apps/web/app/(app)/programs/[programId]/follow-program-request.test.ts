import { describe, expect, it, vi } from "vitest";

import { requestProgramFollow } from "./follow-program-request";

const programId = "0f043d91-d700-4ee1-8f66-9a65c7e59301";
const intakeId = "6a3828b7-4852-4f29-90cd-99b74348f652";
const watchlistId = "ce360523-9c52-438a-b64a-0e7a650c6fc8";

function response(status: number, body: unknown) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: vi.fn(async () => body),
  };
}

describe("requestProgramFollow", () => {
  it("posts the explicitly selected intake and accepts a matching owner response", async () => {
    const fetchFollow = vi.fn(async () =>
      response(201, {
        created: true,
        watchlist: { id: watchlistId, programId, intakeId },
      }),
    );

    await expect(requestProgramFollow(programId, intakeId, fetchFollow)).resolves.toEqual({
      created: true,
      watchlistId,
      programId,
      intakeId,
    });
    expect(fetchFollow).toHaveBeenCalledWith(
      "/api/watchlist",
      expect.objectContaining({
        body: JSON.stringify({ programId, intakeId }),
        credentials: "same-origin",
        method: "POST",
      }),
    );
  });

  it("preserves an idempotent Follow result for onboarding eligibility", async () => {
    await expect(
      requestProgramFollow(programId, intakeId, async () =>
        response(200, {
          created: false,
          watchlist: { id: watchlistId, programId, intakeId },
        }),
      ),
    ).resolves.toEqual({
      created: false,
      watchlistId,
      programId,
      intakeId,
    });
  });

  it("maps an unauthenticated response to an explicit sign-in state", async () => {
    await expect(
      requestProgramFollow(programId, intakeId, async () => response(401, {})),
    ).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  });

  it("rolls back on an unavailable API response", async () => {
    await expect(
      requestProgramFollow(programId, intakeId, async () => response(503, {})),
    ).rejects.toMatchObject({ code: "FOLLOW_UNAVAILABLE" });
  });

  it("rejects a success payload for a different intake", async () => {
    await expect(
      requestProgramFollow(programId, intakeId, async () =>
        response(200, {
          created: false,
          watchlist: {
            id: watchlistId,
            programId,
            intakeId: "a74ebcdb-59c8-4f4d-a8a7-efdfbb0aeb1f",
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "FOLLOW_UNAVAILABLE" });
  });

  it("rejects a success payload that omits the creation result", async () => {
    await expect(
      requestProgramFollow(programId, intakeId, async () =>
        response(201, {
          watchlist: { id: watchlistId, programId, intakeId },
        }),
      ),
    ).rejects.toMatchObject({ code: "FOLLOW_UNAVAILABLE" });
  });
});
