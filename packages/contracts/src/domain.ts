import { z } from "zod";

export const PublicDateStatusSchema = z.enum(["CONFIRMED", "EXPECTED", "NOT_PUBLISHED"]);
export type PublicDateStatus = z.infer<typeof PublicDateStatusSchema>;

export const InternalVerificationStatusSchema = z.enum([
  "OFFICIAL",
  "VERIFIED",
  "EXPECTED",
  "COMMUNITY_SUBMITTED",
  "CONFLICTING",
  "OUTDATED",
  "UNKNOWN",
]);
export type InternalVerificationStatus = z.infer<typeof InternalVerificationStatusSchema>;

export const DegreeTypeSchema = z.enum(["MASTER", "MBA", "PHD", "OTHER"]);
export type DegreeType = z.infer<typeof DegreeTypeSchema>;

export const TrackingStatusSchema = z.enum(["WATCHING", "OPEN_NOW", "APPLIED"]);
export type TrackingStatus = z.infer<typeof TrackingStatusSchema>;

export const SubmissionStatusSchema = z.enum([
  "PENDING",
  "IN_REVIEW",
  "APPROVED",
  "REJECTED",
  "DUPLICATE",
]);
export type SubmissionStatus = z.infer<typeof SubmissionStatusSchema>;

export const NotificationTypeSchema = z.enum([
  "APPLICATION_OPENING",
  "APPLICATION_DEADLINE",
  "DATE_CHANGED",
  "SUBMISSION_APPROVED",
]);
export type NotificationType = z.infer<typeof NotificationTypeSchema>;

export const publicDateCopy: Record<PublicDateStatus, { title: string; description: string }> = {
  CONFIRMED: {
    title: "Confirmed by the university",
    description: "This date was verified on an official university source.",
  },
  EXPECTED: {
    title: "Expected date",
    description: "The university has not published the official date yet.",
  },
  NOT_PUBLISHED: {
    title: "Not published yet",
    description: "We’ll let you know when the university updates it.",
  },
};
