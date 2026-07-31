import type { SubmissionTransport } from "./submission";

export const PROGRAM_SUBMISSION_ENDPOINT = "/api/program-submissions";

/**
 * Network adapter for the missing-program form.
 *
 * Sends the validated submission to POST /api/program-submissions and hands
 * the parsed 201 body back to submitMissingProgram, whose
 * SubmissionResultSchema remains the only judge of a success. Any other
 * outcome — signed out (401), rate limited (429), unknown university (404),
 * server error, network failure — resolves to the "unavailable" result the
 * form already explains, so the student keeps their details and can retry.
 *
 * The body lists each field explicitly: the API schema is `.strict()` and
 * rejects unknown keys, so nothing extra may leak into the payload.
 */
export const programSubmissionApiTransport: SubmissionTransport = async (submission) => {
  const response = await fetch(PROGRAM_SUBMISSION_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({
      universityId: submission.universityId,
      universityName: submission.universityName,
      programName: submission.programName,
      degreeType: submission.degreeType,
      domain: submission.domain,
      officialUrl: submission.officialUrl,
    }),
  });

  if (response.status !== 201) {
    return { status: "unavailable" };
  }

  return (await response.json()) as unknown;
};
