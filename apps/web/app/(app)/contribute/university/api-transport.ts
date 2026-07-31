import type { SubmissionTransport } from "./submission";

export const UNIVERSITY_SUBMISSION_ENDPOINT = "/api/university-submissions";

/**
 * Network adapter for the missing-university form.
 *
 * Sends the validated submission to POST /api/university-submissions and hands
 * the parsed 201 body back to submitMissingUniversity, whose
 * SubmissionResultSchema remains the only judge of a success. Any other
 * outcome — signed out (401), rate limited (429), server error, network
 * failure — resolves to the "unavailable" result the form already explains,
 * so the student keeps their details and can retry.
 *
 * The body lists each field explicitly: the API schema is `.strict()` and
 * rejects unknown keys, so nothing extra may leak into the payload.
 */
export const universitySubmissionApiTransport: SubmissionTransport = async (submission) => {
  const response = await fetch(UNIVERSITY_SUBMISSION_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({
      universityName: submission.universityName,
      country: submission.country,
      officialWebsite: submission.officialWebsite,
    }),
  });

  if (response.status !== 201) {
    return { status: "unavailable" };
  }

  return (await response.json()) as unknown;
};
