export { database } from "./client";
export {
  ActiveUniversityNotFoundError,
  createPendingProgramSubmission,
} from "./program-submissions";
export type {
  PendingProgramSubmission,
  PendingProgramSubmissionInput,
} from "./program-submissions";
export {
  createPendingUniversitySubmission,
  findAuthenticatedUserIdByEmail,
} from "./university-submissions";
export type { PendingUniversitySubmissionInput } from "./university-submissions";
export { followProgram, unfollowProgram, WatchlistTargetNotFoundError } from "./watchlists";
export type { FollowProgramInput, FollowProgramResult, PublicWatchlist } from "./watchlists";
export * from "@prisma/client";
