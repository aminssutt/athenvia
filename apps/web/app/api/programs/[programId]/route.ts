import { ProgramDetailSchema } from "@athenvia/contracts";
import { z } from "zod";

import { findPublicProgramDetail } from "@/lib/program-details";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ProgramIdentifierSchema = z.string().uuid();

const PUBLIC_RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
} as const;

type RouteContext = {
  params: Promise<{
    programId: string;
  }>;
};

function errorResponse(code: string, message: string, status: number): Response {
  return Response.json(
    {
      error: {
        code,
        message,
      },
    },
    {
      headers: PUBLIC_RESPONSE_HEADERS,
      status,
    },
  );
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const { programId } = await context.params;
  if (!ProgramIdentifierSchema.safeParse(programId).success) {
    return errorResponse("INVALID_PROGRAM_ID", "Provide a valid programme identifier.", 400);
  }

  try {
    const detail = await findPublicProgramDetail(programId);
    if (!detail) {
      return errorResponse(
        "PROGRAM_NOT_FOUND",
        "This active programme is not available in the public catalogue.",
        404,
      );
    }

    return Response.json(ProgramDetailSchema.parse(detail), {
      headers: PUBLIC_RESPONSE_HEADERS,
    });
  } catch {
    const requestId = crypto.randomUUID();
    console.error(`[program-detail:${requestId}] catalogue lookup failed`);
    return errorResponse(
      "PROGRAM_DETAIL_UNAVAILABLE",
      "Programme details are unavailable right now. Try again soon.",
      503,
    );
  }
}
