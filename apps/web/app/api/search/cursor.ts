import { z } from "zod";

export const MAXIMUM_SEARCH_OFFSET = 10_000;

const SearchCursorPayloadSchema = z.object({
  offset: z.number().int().nonnegative().max(MAXIMUM_SEARCH_OFFSET),
});

export type SearchCursorPayload = z.infer<typeof SearchCursorPayloadSchema>;

export function decodeSearchCursor(cursor: string | undefined): SearchCursorPayload {
  if (!cursor) {
    return { offset: 0 };
  }

  try {
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    return SearchCursorPayloadSchema.parse(decoded);
  } catch {
    throw new Error("INVALID_CURSOR");
  }
}

export function encodeSearchCursor(payload: SearchCursorPayload): string {
  return Buffer.from(JSON.stringify(SearchCursorPayloadSchema.parse(payload))).toString(
    "base64url",
  );
}
