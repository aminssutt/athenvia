import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { database } from "@athenvia/database";

import { PrismaReminderScheduleRepository } from "./repository";
import { rescheduleWatchlistReminders } from "./scheduler";

const integrationTest =
  process.env.RUN_REMINDER_DATABASE_INTEGRATION === "1" && process.env.DATABASE_URL
    ? test
    : test.skip;

integrationTest(
  "persists, reschedules, and cancels one reminder under a real PostgreSQL advisory lock",
  async () => {
    const userId = randomUUID();
    const universityId = randomUUID();
    const programId = randomUUID();
    const intakeId = randomUUID();
    const applicationWindowId = randomUUID();
    const watchlistId = randomUUID();
    const firstOpening = new Date("2027-05-01T09:00:00.000Z");
    const changedOpening = new Date("2027-05-08T09:00:00.000Z");
    const repository = new PrismaReminderScheduleRepository(database);

    try {
      await database.user.create({
        data: {
          email: `reminder-integration-${userId}@example.test`,
          id: userId,
        },
      });
      await database.university.create({
        data: {
          countryCode: "US",
          id: universityId,
          name: `Reminder integration ${universityId}`,
          normalizedName: `reminder-integration-${universityId}`,
          status: "ACTIVE",
        },
      });
      await database.program.create({
        data: {
          degreeType: "MASTER",
          id: programId,
          name: "Reminder integration program",
          normalizedName: `reminder-integration-${programId}`,
          status: "ACTIVE",
          universityId,
        },
      });
      await database.intake.create({
        data: {
          id: intakeId,
          programId,
          status: "PLANNED",
          year: 2027,
        },
      });
      await database.applicationWindow.create({
        data: {
          id: applicationWindowId,
          intakeId,
          opensAt: firstOpening,
          publicStatus: "CONFIRMED",
        },
      });
      await database.userWatchlist.create({
        data: {
          id: watchlistId,
          intakeId,
          programId,
          userId,
        },
      });
      await database.notificationPreference.create({
        data: {
          beforeDeadlineDays: [],
          beforeOpenDays: [7],
          notifyOnOpen: false,
          watchlistId,
        },
      });
      await database.pushSubscription.create({
        data: {
          auth: "integration-auth",
          endpoint: `https://push.example.test/${userId}`,
          p256dh: "integration-p256dh",
          userId,
        },
      });

      const initialRuns = await Promise.all([
        rescheduleWatchlistReminders(watchlistId, {
          now: new Date("2027-01-01T00:00:00.000Z"),
          repository,
        }),
        rescheduleWatchlistReminders(watchlistId, {
          now: new Date("2027-01-01T00:00:00.000Z"),
          repository,
        }),
      ]);
      assert.equal(
        initialRuns.reduce(
          (count, result) =>
            count + (result.status === "RESCHEDULED" ? result.reconciliation.created : 0),
          0,
        ),
        1,
      );
      const initialRows = await database.notificationDelivery.findMany({
        where: { watchlistId },
      });
      assert.equal(initialRows.length, 1);
      const initial = initialRows[0];
      assert.ok(initial);
      assert.equal(initial.scheduledFor.toISOString(), "2027-04-24T09:00:00.000Z");

      await database.applicationWindow.update({
        data: { opensAt: changedOpening },
        where: { id: applicationWindowId },
      });
      const rescheduled = await rescheduleWatchlistReminders(watchlistId, {
        now: new Date("2027-01-01T00:00:00.000Z"),
        repository,
      });
      assert.equal(
        rescheduled.status === "RESCHEDULED" && rescheduled.reconciliation.rescheduled,
        1,
      );
      const changed = await database.notificationDelivery.findFirstOrThrow({
        where: { watchlistId },
      });
      assert.equal(changed.id, initial.id);
      assert.equal(changed.scheduledFor.toISOString(), "2027-05-01T09:00:00.000Z");

      await database.notificationPreference.update({
        data: { beforeOpenDays: [] },
        where: { watchlistId },
      });
      const cancelled = await rescheduleWatchlistReminders(watchlistId, {
        now: new Date("2027-01-01T00:00:00.000Z"),
        repository,
      });
      assert.equal(cancelled.status === "RESCHEDULED" && cancelled.reconciliation.cancelled, 1);
      assert.equal(
        (
          await database.notificationDelivery.findFirstOrThrow({
            where: { watchlistId },
          })
        ).status,
        "CANCELLED",
      );
    } finally {
      await database.user.deleteMany({ where: { id: userId } });
      await database.university.deleteMany({ where: { id: universityId } });
    }
  },
);
