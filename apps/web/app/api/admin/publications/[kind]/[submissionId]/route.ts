import {
  ApprovedSubmissionNotFoundError,
  publishApprovedProgramSubmission,
  publishApprovedUniversitySubmission,
  SubmissionReviewRequiredError,
} from "@athenvia/database";
import { NextResponse } from "next/server";

import { isTrustedAdminWrite, resolveAdminAccess } from "../../../reviews/security";

type RouteContext = {
  params: Promise<{ kind: string; submissionId: string }>;
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    headers: { "Cache-Control": "private, no-store" },
    status,
  });
}

export async function POST(request: Request, context: RouteContext) {
  if (!isTrustedAdminWrite(request)) {
    return json({ error: "Invalid request origin." }, 403);
  }
  const access = await resolveAdminAccess();
  if (access.status === "UNAUTHENTICATED") {
    return json({ error: "Authentication required." }, 401);
  }
  if (access.status === "FORBIDDEN") {
    return json({ error: "Administrator access required." }, 403);
  }

  const { kind, submissionId } = await context.params;
  try {
    const result =
      kind === "university"
        ? await publishApprovedUniversitySubmission(submissionId)
        : kind === "program"
          ? await publishApprovedProgramSubmission(submissionId)
          : null;
    if (!result) {
      return json({ error: "Publication kind must be university or program." }, 400);
    }
    return json({
      ...result,
      contributorNotification: {
        type: "SUBMISSION_APPROVED",
        userId: result.contributorUserId,
      },
    });
  } catch (error) {
    if (error instanceof ApprovedSubmissionNotFoundError) {
      return json({ error: error.message }, 404);
    }
    if (error instanceof SubmissionReviewRequiredError) {
      return json({ error: error.message }, 409);
    }
    throw error;
  }
}
