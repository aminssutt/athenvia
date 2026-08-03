import { describe, expect, it, vi } from "vitest";

import {
  AdminReviewApplyError,
  AdminReviewConflictError,
  decideAdminReviewWith,
  describeCreator,
} from "./service";

function fakeDatabase(
  competitors: number,
  revisionOverrides: Record<string, unknown> = {},
  windowOverrides: Record<string, unknown> | null = {},
) {
  const window =
    windowOverrides === null
      ? null
      : {
          closesAt: null,
          id: "entity-1",
          lastVerifiedAt: null,
          opensAt: null,
          publicStatus: "NOT_PUBLISHED",
          ...windowOverrides,
        };
  const transaction = {
    applicationWindow: {
      findUnique: vi.fn().mockResolvedValue(window),
      update: vi.fn().mockResolvedValue({ id: "entity-1" }),
    },
    dataRevision: {
      count: vi.fn().mockResolvedValue(competitors),
      create: vi.fn().mockResolvedValue({ id: "audit-1" }),
      findFirst: vi.fn().mockResolvedValue({
        conflictKey: "APPLICATION_WINDOW:entity-1:closesAt",
        hasConflict: true,
        id: "revision-1",
        newValue: null,
        source: { lastCheckedAt: new Date("2027-01-05T08:00:00.000Z") },
        sourceId: "source-1",
        sourceSnapshotId: "snapshot-1",
        ...revisionOverrides,
      }),
      update: vi.fn().mockResolvedValue({ id: "revision-1" }),
    },
    programSubmission: { update: vi.fn() },
    universitySubmission: { update: vi.fn() },
  };
  return {
    database: {
      $transaction: (callback: (client: typeof transaction) => Promise<void>) =>
        callback(transaction),
    },
    transaction,
  };
}

function windowRevision(overrides: Record<string, unknown> = {}) {
  return {
    entityId: "entity-1",
    entityType: "APPLICATION_WINDOW",
    fieldName: "closesAt",
    hasConflict: false,
    newValue: "2027-03-15T12:00:00.000Z",
    ...overrides,
  };
}

describe("review card provenance", () => {
  it("labels worker-created revisions as the verification worker", () => {
    expect(
      describeCreator({ createdBy: null, createdByWorker: true, fieldName: "submissionReview" }),
    ).toBe("Athenvia verification worker");
  });

  it("labels a student submission with the contributor's email", () => {
    expect(
      describeCreator({
        createdBy: { email: "student@example.com" },
        createdByWorker: false,
        fieldName: "submissionReview",
      }),
    ).toBe("a student (student@example.com)");
  });

  it("keeps an anonymized contributor neutral", () => {
    expect(
      describeCreator({
        createdBy: { email: "deleted-user-1@deleted.invalid" },
        createdByWorker: false,
        fieldName: "submissionReview",
      }),
    ).toBe("a student (account deleted)");
  });

  it("labels other human revisions with the reviewer's email", () => {
    expect(
      describeCreator({
        createdBy: { email: "admin@example.com" },
        createdByWorker: false,
        fieldName: "reviewDecision",
      }),
    ).toBe("admin@example.com");
  });
});

describe("admin review decisions", () => {
  it("cannot approve while a competing pending value remains", async () => {
    const fake = fakeDatabase(1);
    await expect(
      decideAdminReviewWith(fake.database as never, "revision-1", "admin-1", "APPROVE"),
    ).rejects.toBeInstanceOf(AdminReviewConflictError);
    expect(fake.transaction.dataRevision.update).not.toHaveBeenCalled();
    expect(fake.transaction.dataRevision.create).not.toHaveBeenCalled();
  });

  it("clears a reviewed conflict, approves, and appends reviewer identity", async () => {
    const fake = fakeDatabase(0);
    await decideAdminReviewWith(fake.database as never, "revision-1", "admin-1", "APPROVE");

    expect(fake.transaction.dataRevision.update).toHaveBeenCalledWith({
      data: {
        changeStatus: "APPROVED",
        hasConflict: false,
        reviewedAt: expect.any(Date),
      },
      where: { id: "revision-1" },
    });
    expect(fake.transaction.dataRevision.create).toHaveBeenCalledWith({
      data: {
        changeStatus: "APPROVED",
        createdByUserId: "admin-1",
        createdByWorker: false,
        entityId: "revision-1",
        entityType: "DATA_REVISION",
        fieldName: "reviewDecision",
        newValue: { changeStatus: "APPROVED", reviewerId: "admin-1" },
        oldValue: { changeStatus: "PENDING" },
        reviewedAt: expect.any(Date),
        sourceId: "source-1",
        sourceSnapshotId: "snapshot-1",
      },
    });
  });

  it("marks an approved university proposal ready for publication", async () => {
    const fake = fakeDatabase(0, {
      entityId: "submission-1",
      entityType: "UNIVERSITY_SUBMISSION",
      fieldName: "submissionReview",
      hasConflict: false,
    });
    await decideAdminReviewWith(fake.database as never, "revision-1", "admin-1", "APPROVE");

    expect(fake.transaction.universitySubmission.update).toHaveBeenCalledWith({
      data: { reviewedAt: expect.any(Date), status: "APPROVED" },
      where: { id: "submission-1" },
    });
  });
});

describe("applying approved application-window dates", () => {
  it("publishes the approved deadline on the canonical window", async () => {
    const fake = fakeDatabase(0, windowRevision());
    await decideAdminReviewWith(fake.database as never, "revision-1", "admin-1", "APPROVE");

    expect(fake.transaction.applicationWindow.update).toHaveBeenCalledWith({
      data: {
        closesAt: new Date("2027-03-15T12:00:00.000Z"),
        lastVerifiedAt: new Date("2027-01-05T08:00:00.000Z"),
        publicStatus: "CONFIRMED",
        sourceId: "source-1",
        verification: "OFFICIAL",
      },
      where: { id: "entity-1" },
    });
    expect(fake.transaction.dataRevision.update).toHaveBeenCalled();
  });

  it("stores a day-precision deadline at noon UTC", async () => {
    const fake = fakeDatabase(0, windowRevision({ newValue: "2027-03-15" }));
    await decideAdminReviewWith(fake.database as never, "revision-1", "admin-1", "APPROVE");

    expect(fake.transaction.applicationWindow.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ closesAt: new Date("2027-03-15T12:00:00.000Z") }),
      }),
    );
  });

  it("returns the window to NOT_PUBLISHED when the last date is removed", async () => {
    const fake = fakeDatabase(0, windowRevision({ newValue: null }), {
      closesAt: new Date("2027-02-01T12:00:00.000Z"),
      lastVerifiedAt: new Date("2027-01-01T00:00:00.000Z"),
      publicStatus: "CONFIRMED",
    });
    await decideAdminReviewWith(fake.database as never, "revision-1", "admin-1", "APPROVE");

    expect(fake.transaction.applicationWindow.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ closesAt: null, publicStatus: "NOT_PUBLISHED" }),
      }),
    );
  });

  it("keeps CONFIRMED when the other exact date remains", async () => {
    const fake = fakeDatabase(0, windowRevision({ newValue: null }), {
      closesAt: new Date("2027-02-01T12:00:00.000Z"),
      lastVerifiedAt: new Date("2027-01-01T00:00:00.000Z"),
      opensAt: new Date("2026-11-01T12:00:00.000Z"),
      publicStatus: "CONFIRMED",
    });
    await decideAdminReviewWith(fake.database as never, "revision-1", "admin-1", "APPROVE");

    expect(fake.transaction.applicationWindow.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ closesAt: null, publicStatus: "CONFIRMED" }),
      }),
    );
  });

  it("skips the write when the canonical value already matches", async () => {
    const fake = fakeDatabase(0, windowRevision(), {
      closesAt: new Date("2027-03-15T12:00:00.000Z"),
      publicStatus: "CONFIRMED",
    });
    await decideAdminReviewWith(fake.database as never, "revision-1", "admin-1", "APPROVE");

    expect(fake.transaction.applicationWindow.update).not.toHaveBeenCalled();
    expect(fake.transaction.dataRevision.update).toHaveBeenCalled();
  });

  it("refuses evidence older than the window's latest verification", async () => {
    const fake = fakeDatabase(0, windowRevision(), {
      lastVerifiedAt: new Date("2027-01-06T00:00:00.000Z"),
    });
    await expect(
      decideAdminReviewWith(fake.database as never, "revision-1", "admin-1", "APPROVE"),
    ).rejects.toBeInstanceOf(AdminReviewApplyError);
    expect(fake.transaction.applicationWindow.update).not.toHaveBeenCalled();
    expect(fake.transaction.dataRevision.update).not.toHaveBeenCalled();
  });

  it("refuses a revision whose source has never been checked", async () => {
    const fake = fakeDatabase(0, windowRevision({ source: { lastCheckedAt: null } }));
    await expect(
      decideAdminReviewWith(fake.database as never, "revision-1", "admin-1", "APPROVE"),
    ).rejects.toBeInstanceOf(AdminReviewApplyError);
    expect(fake.transaction.applicationWindow.update).not.toHaveBeenCalled();
  });

  it("refuses a malformed approved value", async () => {
    const fake = fakeDatabase(0, windowRevision({ newValue: "next spring" }));
    await expect(
      decideAdminReviewWith(fake.database as never, "revision-1", "admin-1", "APPROVE"),
    ).rejects.toBeInstanceOf(AdminReviewApplyError);
    expect(fake.transaction.applicationWindow.update).not.toHaveBeenCalled();
  });

  it("refuses to approve when the window no longer exists", async () => {
    const fake = fakeDatabase(0, windowRevision(), null);
    await expect(
      decideAdminReviewWith(fake.database as never, "revision-1", "admin-1", "APPROVE"),
    ).rejects.toBeInstanceOf(AdminReviewApplyError);
    expect(fake.transaction.dataRevision.update).not.toHaveBeenCalled();
  });

  it("never touches the window on rejection", async () => {
    const fake = fakeDatabase(0, windowRevision());
    await decideAdminReviewWith(fake.database as never, "revision-1", "admin-1", "REJECT");

    expect(fake.transaction.applicationWindow.findUnique).not.toHaveBeenCalled();
    expect(fake.transaction.applicationWindow.update).not.toHaveBeenCalled();
  });
});
