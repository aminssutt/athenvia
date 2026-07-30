import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { database } from "../src/client";
import { followProgram, unfollowProgram, WatchlistTargetNotFoundError } from "../src/watchlists";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must point to a disposable, migrated PostgreSQL database.");
}

const suffix = randomUUID().slice(0, 8);
const ownerEmail = `watchlist-owner-${suffix}@example.test`;
const otherEmail = `watchlist-other-${suffix}@example.test`;
const universityName = `Watchlist Test University ${suffix}`;

const owner = await database.user.create({
  data: { email: ownerEmail },
  select: { id: true },
});
const otherUser = await database.user.create({
  data: { email: otherEmail },
  select: { id: true },
});
const university = await database.university.create({
  data: {
    name: universityName,
    normalizedName: universityName.toLowerCase(),
    countryCode: "FR",
    status: "ACTIVE",
  },
  select: { id: true },
});

try {
  const program = await database.program.create({
    data: {
      universityId: university.id,
      name: `Active Program ${suffix}`,
      normalizedName: `active program ${suffix}`,
      degreeType: "MASTER",
      status: "ACTIVE",
      intakes: {
        create: {
          year: 2030,
          month: 9,
          status: "PLANNED",
        },
      },
    },
    include: { intakes: { select: { id: true } } },
  });
  const intakeId = program.intakes[0]?.id;
  assert.ok(intakeId);

  const otherProgram = await database.program.create({
    data: {
      universityId: university.id,
      name: `Other Program ${suffix}`,
      normalizedName: `other program ${suffix}`,
      degreeType: "MASTER",
      status: "ACTIVE",
      intakes: {
        create: {
          year: 2031,
          month: 9,
          status: "PLANNED",
        },
      },
    },
    include: { intakes: { select: { id: true } } },
  });
  const otherIntakeId = otherProgram.intakes[0]?.id;
  assert.ok(otherIntakeId);

  await assert.rejects(
    followProgram({
      userId: owner.id,
      programId: program.id,
      intakeId: otherIntakeId,
    }),
    WatchlistTargetNotFoundError,
  );

  const firstFollow = await followProgram({
    userId: owner.id,
    programId: program.id,
    intakeId,
  });
  assert.equal(firstFollow.created, true);
  assert.deepEqual(firstFollow.watchlist.notificationPreference, {
    beforeOpenDays: [30, 7],
    beforeDeadlineDays: [30, 14, 7, 2],
    notifyOnOpen: true,
    notifyOnDateChange: true,
    pushEnabled: false,
  });

  const duplicateFollow = await followProgram({
    userId: owner.id,
    programId: program.id,
    intakeId,
  });
  assert.equal(duplicateFollow.created, false);
  assert.equal(duplicateFollow.watchlist.id, firstFollow.watchlist.id);
  assert.equal(
    await database.userWatchlist.count({
      where: { userId: owner.id, programId: program.id, intakeId },
    }),
    1,
  );
  assert.equal(
    await database.notificationPreference.count({
      where: { watchlistId: firstFollow.watchlist.id },
    }),
    1,
  );

  assert.equal(await unfollowProgram(otherUser.id, firstFollow.watchlist.id), false);
  assert.equal(await database.userWatchlist.count({ where: { id: firstFollow.watchlist.id } }), 1);

  assert.equal(await unfollowProgram(owner.id, firstFollow.watchlist.id), true);
  assert.equal(await unfollowProgram(owner.id, firstFollow.watchlist.id), false);
  assert.equal(
    await database.notificationPreference.count({
      where: { watchlistId: firstFollow.watchlist.id },
    }),
    0,
  );

  const concurrentFollows = await Promise.all(
    Array.from({ length: 4 }, () =>
      followProgram({
        userId: owner.id,
        programId: program.id,
        intakeId,
      }),
    ),
  );
  assert.equal(concurrentFollows.filter(({ created }) => created).length, 1);
  assert.equal(new Set(concurrentFollows.map(({ watchlist }) => watchlist.id)).size, 1);
  assert.equal(
    await database.userWatchlist.count({
      where: { userId: owner.id, programId: program.id, intakeId },
    }),
    1,
  );

  await assert.rejects(
    followProgram({
      userId: randomUUID(),
      programId: otherProgram.id,
      intakeId: otherIntakeId,
    }),
  );
  assert.equal(
    await database.userWatchlist.count({
      where: { programId: otherProgram.id, intakeId: otherIntakeId },
    }),
    0,
  );
} finally {
  await database.user.deleteMany({
    where: { id: { in: [owner.id, otherUser.id] } },
  });
  await database.university.deleteMany({
    where: { id: university.id },
  });
  await database.$disconnect();
}

console.log("Watchlist integration checks passed.");
