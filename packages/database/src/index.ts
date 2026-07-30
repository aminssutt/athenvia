export { database } from "./client";
export { createCanonicalFieldRevision, RevisionEvidenceNotFoundError } from "./canonical-revisions";
export type {
  CanonicalRevisionInput,
  CanonicalRevisionResult,
  RevisionCreator,
} from "./canonical-revisions";
export {
  catalogueNameSimilarity,
  normalizeCatalogueName,
  normalizeOfficialDomain,
  normalizeOfficialUrl,
} from "./catalogue-normalization";
export {
  createDuplicateReview,
  detectProgramDuplicateCandidates,
  detectUniversityDuplicateCandidates,
  DUPLICATE_REVIEW_FIELD,
  findProgramDuplicateCandidates,
  findUniversityDuplicateCandidates,
} from "./duplicate-detection";
export type {
  DuplicateCandidate,
  DuplicateMatchReason,
  ProgramDuplicateInput,
  ProgramDuplicateRecord,
  UniversityDuplicateInput,
  UniversityDuplicateRecord,
} from "./duplicate-detection";
export {
  ActiveUniversityNotFoundError,
  createPendingProgramSubmission,
} from "./program-submissions";
export {
  ApprovedSubmissionNotFoundError,
  publishApprovedProgramSubmission,
  publishApprovedUniversitySubmission,
  SubmissionReviewRequiredError,
} from "./publish-submissions";
export type { PublicationResult } from "./publish-submissions";
export type {
  PendingProgramSubmission,
  PendingProgramSubmissionInput,
} from "./program-submissions";
export {
  createPendingUniversitySubmission,
  findAuthenticatedUserIdByEmail,
} from "./university-submissions";
export type { PendingUniversitySubmissionInput } from "./university-submissions";
export {
  recordSourceSnapshot,
  sourceSnapshotStorageKey,
  SnapshotSourceNotFoundError,
  SnapshotStorageKeyConflictError,
} from "./source-snapshots";
export {
  MAX_ACTIVE_PUSH_SUBSCRIPTIONS_PER_USER,
  PushSubscriptionLimitReachedError,
  PushSubscriptionOwnershipConflictError,
  revokePushSubscription,
  storePushSubscription,
} from "./push-subscriptions";
export type { StorePushSubscriptionInput } from "./push-subscriptions";
export { createSubmissionReview, SUBMISSION_REVIEW_FIELD } from "./submission-reviews";
export type {
  RecordSourceSnapshotInput,
  RecordSourceSnapshotResult,
  SourceSnapshotEvidence,
  SourceSnapshotIdentity,
} from "./source-snapshots";
export { followProgram, unfollowProgram, WatchlistTargetNotFoundError } from "./watchlists";
export type { FollowProgramInput, FollowProgramResult, PublicWatchlist } from "./watchlists";
export * from "@prisma/client";
