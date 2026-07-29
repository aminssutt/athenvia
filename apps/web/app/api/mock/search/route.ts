import { mockSearchResponse } from "@athenvia/contracts/mocks";

export function GET() {
  return Response.json(mockSearchResponse);
}
