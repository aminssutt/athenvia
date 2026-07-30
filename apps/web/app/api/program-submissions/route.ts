import { createPendingProgramSubmission } from "@athenvia/database";

import { createProgramSubmissionPostHandler } from "./handler";
import { checkProgramSubmissionRateLimit, programSubmissionRateLimitHeaders } from "./rate-limit";
import {
  authenticatedProgramSubmitterId,
  isTrustedProgramSubmissionOrigin,
} from "./request-security";

export const dynamic = "force-dynamic";

export const POST = createProgramSubmissionPostHandler({
  authenticatedUserId: authenticatedProgramSubmitterId,
  checkRateLimit: checkProgramSubmissionRateLimit,
  createSubmission: createPendingProgramSubmission,
  isTrustedOrigin: isTrustedProgramSubmissionOrigin,
  rateLimitHeaders: programSubmissionRateLimitHeaders,
});
