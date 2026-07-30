import { EntityStatus, SubmissionStatus, type Prisma, type PrismaClient } from "@prisma/client";

import { normalizeCatalogueName, normalizeOfficialDomain } from "./catalogue-normalization";
import { database } from "./client";
import {
  findProgramDuplicateCandidates,
  findUniversityDuplicateCandidates,
} from "./duplicate-detection";
import { SUBMISSION_REVIEW_FIELD } from "./submission-reviews";

type PublicationDatabase = Pick<PrismaClient, "$transaction">;
const PUBLICATION_FIELD = "publishedEntity";

export type PublicationResult = Readonly<{
  contributorUserId: string;
  entityId: string | null;
  outcome: "DUPLICATE" | "PUBLISHED";
  submissionId: string;
  submissionType: "PROGRAM" | "UNIVERSITY";
}>;

export class ApprovedSubmissionNotFoundError extends Error {
  constructor() {
    super("The approved submission does not exist.");
    this.name = "ApprovedSubmissionNotFoundError";
  }
}

export class SubmissionReviewRequiredError extends Error {
  constructor() {
    super("The submission does not have an approved review.");
    this.name = "SubmissionReviewRequiredError";
  }
}

async function requireApprovedReview(
  transaction: Prisma.TransactionClient,
  entityType: "PROGRAM_SUBMISSION" | "UNIVERSITY_SUBMISSION",
  entityId: string,
): Promise<void> {
  const review = await transaction.dataRevision.findFirst({
    where: {
      changeStatus: "APPROVED",
      entityId,
      entityType,
      fieldName: SUBMISSION_REVIEW_FIELD,
    },
    select: { id: true },
  });
  const pendingReviews = await transaction.dataRevision.count({
    where: {
      changeStatus: "PENDING",
      entityId,
      entityType,
    },
  });
  if (!review || pendingReviews > 0) {
    throw new SubmissionReviewRequiredError();
  }
}

async function priorPublication(
  transaction: Prisma.TransactionClient,
  entityType: "PROGRAM_SUBMISSION" | "UNIVERSITY_SUBMISSION",
  submissionId: string,
  contributorUserId: string,
  submissionType: PublicationResult["submissionType"],
): Promise<PublicationResult | null> {
  const audit = await transaction.dataRevision.findFirst({
    where: {
      changeStatus: "APPROVED",
      entityId: submissionId,
      entityType,
      fieldName: PUBLICATION_FIELD,
    },
    orderBy: { createdAt: "asc" },
    select: { newValue: true },
  });
  const value = audit?.newValue;
  const entityId =
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof value.entityId === "string"
      ? value.entityId
      : null;
  return entityId
    ? Object.freeze({
        contributorUserId,
        entityId,
        outcome: "PUBLISHED",
        submissionId,
        submissionType,
      })
    : null;
}

async function recordPublication(
  transaction: Prisma.TransactionClient,
  entityType: "PROGRAM_SUBMISSION" | "UNIVERSITY_SUBMISSION",
  submissionId: string,
  entityId: string,
): Promise<void> {
  await transaction.dataRevision.create({
    data: {
      changeStatus: "APPROVED",
      createdByWorker: true,
      entityId: submissionId,
      entityType,
      fieldName: PUBLICATION_FIELD,
      newValue: { entityId },
      reviewedAt: new Date(),
    },
  });
}

function domainSlug(value: string): string {
  return normalizeCatalogueName(value).replaceAll(" ", "-");
}

export async function publishApprovedUniversitySubmission(
  submissionId: string,
  databaseClient: PublicationDatabase = database,
): Promise<PublicationResult> {
  return databaseClient.$transaction(async (transaction) => {
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"university-submission:" + submissionId}, 0))`;
    const submission = await transaction.universitySubmission.findFirst({
      where: { id: submissionId, status: SubmissionStatus.APPROVED },
    });
    if (!submission) {
      throw new ApprovedSubmissionNotFoundError();
    }
    const published = await priorPublication(
      transaction,
      "UNIVERSITY_SUBMISSION",
      submission.id,
      submission.submittedByUserId,
      "UNIVERSITY",
    );
    if (published) {
      return published;
    }
    await requireApprovedReview(transaction, "UNIVERSITY_SUBMISSION", submission.id);
    const duplicates = await findUniversityDuplicateCandidates(submission, transaction);
    if (duplicates.length > 0) {
      await transaction.universitySubmission.update({
        where: { id: submission.id },
        data: { reviewedAt: new Date(), status: SubmissionStatus.DUPLICATE },
      });
      return Object.freeze({
        contributorUserId: submission.submittedByUserId,
        entityId: null,
        outcome: "DUPLICATE",
        submissionId: submission.id,
        submissionType: "UNIVERSITY",
      });
    }

    const officialDomain = normalizeOfficialDomain(submission.officialWebsite);
    const university = await transaction.university.create({
      data: {
        countryCode: submission.countryCode,
        createdByUserId: submission.submittedByUserId,
        name: submission.name,
        normalizedName: normalizeCatalogueName(submission.name),
        officialDomain,
        officialWebsite: submission.officialWebsite,
        status: EntityStatus.ACTIVE,
      },
      select: { id: true },
    });
    if (submission.officialWebsite) {
      await transaction.source.create({
        data: {
          isOfficial: true,
          sourceType: "USER_SUBMITTED_OFFICIAL_LINK",
          universityId: university.id,
          url: submission.officialWebsite,
        },
      });
    }
    await recordPublication(transaction, "UNIVERSITY_SUBMISSION", submission.id, university.id);
    return Object.freeze({
      contributorUserId: submission.submittedByUserId,
      entityId: university.id,
      outcome: "PUBLISHED",
      submissionId: submission.id,
      submissionType: "UNIVERSITY",
    });
  });
}

export async function publishApprovedProgramSubmission(
  submissionId: string,
  databaseClient: PublicationDatabase = database,
): Promise<PublicationResult> {
  return databaseClient.$transaction(async (transaction) => {
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"program-submission:" + submissionId}, 0))`;
    const submission = await transaction.programSubmission.findFirst({
      where: {
        id: submissionId,
        status: SubmissionStatus.APPROVED,
        university: { status: EntityStatus.ACTIVE },
      },
    });
    if (!submission) {
      throw new ApprovedSubmissionNotFoundError();
    }
    const published = await priorPublication(
      transaction,
      "PROGRAM_SUBMISSION",
      submission.id,
      submission.submittedByUserId,
      "PROGRAM",
    );
    if (published) {
      return published;
    }
    await requireApprovedReview(transaction, "PROGRAM_SUBMISSION", submission.id);
    const duplicates = await findProgramDuplicateCandidates(submission, transaction);
    if (duplicates.length > 0) {
      await transaction.programSubmission.update({
        where: { id: submission.id },
        data: { reviewedAt: new Date(), status: SubmissionStatus.DUPLICATE },
      });
      return Object.freeze({
        contributorUserId: submission.submittedByUserId,
        entityId: null,
        outcome: "DUPLICATE",
        submissionId: submission.id,
        submissionType: "PROGRAM",
      });
    }

    const domain = await transaction.domain.upsert({
      where: { slug: domainSlug(submission.domain) },
      create: { name: submission.domain, slug: domainSlug(submission.domain) },
      update: {},
      select: { id: true },
    });
    const program = await transaction.program.create({
      data: {
        createdByUserId: submission.submittedByUserId,
        degreeType: submission.degreeType,
        domains: { create: { domainId: domain.id } },
        name: submission.name,
        normalizedName: normalizeCatalogueName(submission.name),
        officialUrl: submission.officialUrl,
        status: EntityStatus.ACTIVE,
        universityId: submission.universityId,
      },
      select: { id: true },
    });
    if (submission.officialUrl) {
      await transaction.source.create({
        data: {
          isOfficial: true,
          programId: program.id,
          sourceType: "USER_SUBMITTED_OFFICIAL_LINK",
          url: submission.officialUrl,
        },
      });
    }
    await recordPublication(transaction, "PROGRAM_SUBMISSION", submission.id, program.id);
    return Object.freeze({
      contributorUserId: submission.submittedByUserId,
      entityId: program.id,
      outcome: "PUBLISHED",
      submissionId: submission.id,
      submissionType: "PROGRAM",
    });
  });
}
