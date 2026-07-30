import {
  createPendingUniversitySubmission,
  findAuthenticatedUserIdByEmail,
} from "@athenvia/database";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";

import { createUniversitySubmissionPostHandler } from "./handler";
import { checkUniversitySubmissionRateLimit } from "./rate-limit";
import { validateOfficialWebsite } from "./safe-url";

export const dynamic = "force-dynamic";

async function authenticatedUserId() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  return email ? findAuthenticatedUserIdByEmail(email) : null;
}

export const POST = createUniversitySubmissionPostHandler({
  getAuthenticatedUserId: authenticatedUserId,
  checkRateLimit: checkUniversitySubmissionRateLimit,
  validateWebsite: validateOfficialWebsite,
  createSubmission: createPendingUniversitySubmission,
});
