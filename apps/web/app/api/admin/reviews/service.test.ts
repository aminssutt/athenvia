import { describe, expect, it, vi } from "vitest";

import { AdminReviewConflictError, decideAdminReviewWith } from "./service";

function fakeDatabase(competitors: number) {
  const transaction = {
    dataRevision: {
      count: vi.fn().mockResolvedValue(competitors),
      create: vi.fn().mockResolvedValue({ id: "audit-1" }),
      findFirst: vi.fn().mockResolvedValue({
        conflictKey: "APPLICATION_WINDOW:entity-1:closesAt",
        hasConflict: true,
        id: "revision-1",
        sourceId: "source-1",
        sourceSnapshotId: "snapshot-1",
      }),
      update: vi.fn().mockResolvedValue({ id: "revision-1" }),
    },
  };
  return {
    database: {
      $transaction: (callback: (client: typeof transaction) => Promise<void>) =>
        callback(transaction),
    },
    transaction,
  };
}

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
});
