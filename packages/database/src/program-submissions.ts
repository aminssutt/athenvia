import { EntityStatus, SubmissionStatus } from "@prisma/client";

import { normalizeCatalogueName } from "./catalogue-normalization";
import { database } from "./client";
import { createDuplicateReview, findProgramDuplicateCandidates } from "./duplicate-detection";
import { createSubmissionReview } from "./submission-reviews";

import type { DegreeType } from "@prisma/client";

export type PendingProgramSubmissionInput = {
  submittedByUserId: string;
  universityId: string;
  universityName: string;
  name: string;
  degreeType: DegreeType;
  domain: string;
  officialUrl: string | null;
};

export type PendingProgramSubmission = {
  id: string;
  status: SubmissionStatus;
};

export class ActiveUniversityNotFoundError extends Error {
  constructor() {
    super("The selected active university does not exist.");
    this.name = "ActiveUniversityNotFoundError";
  }
}

function comparableUniversityName(value: string): string {
  return normalizeCatalogueName(value);
}

/**
 * Stores only a server-owned PENDING record after resolving the university
 * inside the same transaction. The submitted display name must still identify
 * the active university selected by the client.
 */
export async function createPendingProgramSubmission(
  input: PendingProgramSubmissionInput,
): Promise<PendingProgramSubmission> {
  return database.$transaction(async (transaction) => {
    const university = await transaction.university.findFirst({
      where: {
        id: input.universityId,
        status: EntityStatus.ACTIVE,
      },
      select: {
        id: true,
        name: true,
      },
    });

    if (
      !university ||
      comparableUniversityName(university.name) !== comparableUniversityName(input.universityName)
    ) {
      throw new ActiveUniversityNotFoundError();
    }

    const submission = await transaction.programSubmission.create({
      data: {
        submittedByUserId: input.submittedByUserId,
        universityId: university.id,
        name: input.name,
        degreeType: input.degreeType,
        domain: input.domain,
        officialUrl: input.officialUrl,
        status: SubmissionStatus.PENDING,
      },
      select: {
        id: true,
        status: true,
      },
    });
    const candidates = await findProgramDuplicateCandidates(
      {
        universityId: university.id,
        name: input.name,
        degreeType: input.degreeType,
        officialUrl: input.officialUrl,
      },
      transaction,
    );
    await createSubmissionReview(
      transaction,
      "PROGRAM_SUBMISSION",
      submission.id,
      input.submittedByUserId,
      {
        degreeType: input.degreeType,
        domain: input.domain,
        name: input.name,
        officialUrl: input.officialUrl,
        universityId: university.id,
      },
    );
    await createDuplicateReview(transaction, "PROGRAM_SUBMISSION", submission.id, candidates);
    return submission;
  });
}
