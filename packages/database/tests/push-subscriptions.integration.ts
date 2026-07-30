import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { database } from "../src/client";
import {
  MAX_ACTIVE_PUSH_SUBSCRIPTIONS_PER_USER,
  PushSubscriptionLimitReachedError,
  PushSubscriptionOwnershipConflictError,
  revokePushSubscription,
  storePushSubscription,
} from "../src/push-subscriptions";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must point to a disposable, migrated PostgreSQL database.");
}

const suffix = randomUUID().slice(0, 8);
const endpoint = `https://push.example.test/subscriptions/${suffix}`;
const owner = await database.user.create({
  data: { email: `push-owner-${suffix}@example.test` },
  select: { id: true },
});
const nextOwner = await database.user.create({
  data: { email: `push-next-owner-${suffix}@example.test` },
  select: { id: true },
});
const quotaOwner = await database.user.create({
  data: { email: `push-quota-${suffix}@example.test` },
  select: { id: true },
});

try {
  await Promise.all(
    Array.from({ length: 4 }, (_, index) =>
      storePushSubscription({
        userId: owner.id,
        endpoint,
        p256dh: `owner-p256dh-${index}`,
        auth: `owner-auth-${index}`,
        userAgent: "Integration Browser",
      }),
    ),
  );

  assert.equal(await database.pushSubscription.count({ where: { endpoint } }), 1);
  const concurrentResult = await database.pushSubscription.findUniqueOrThrow({
    where: { endpoint },
  });
  assert.equal(concurrentResult.userId, owner.id);
  assert.match(concurrentResult.p256dh, /^owner-p256dh-[0-3]$/);
  assert.match(concurrentResult.auth, /^owner-auth-[0-3]$/);

  await assert.rejects(
    storePushSubscription({
      userId: nextOwner.id,
      endpoint,
      p256dh: "foreign-p256dh",
      auth: "foreign-auth",
      userAgent: "Foreign Browser",
    }),
    PushSubscriptionOwnershipConflictError,
  );

  const afterConflict = await database.pushSubscription.findUniqueOrThrow({
    where: { endpoint },
  });
  assert.equal(afterConflict.id, concurrentResult.id);
  assert.equal(afterConflict.userId, owner.id);
  assert.equal(afterConflict.p256dh, concurrentResult.p256dh);
  assert.equal(afterConflict.auth, concurrentResult.auth);

  await revokePushSubscription(nextOwner.id, endpoint);
  assert.equal(
    (await database.pushSubscription.findUniqueOrThrow({ where: { endpoint } })).revokedAt,
    null,
  );

  await revokePushSubscription(owner.id, endpoint);
  const revokedAt = (await database.pushSubscription.findUniqueOrThrow({ where: { endpoint } }))
    .revokedAt;
  assert.ok(revokedAt);

  await revokePushSubscription(owner.id, endpoint);
  assert.equal(
    (
      await database.pushSubscription.findUniqueOrThrow({
        where: { endpoint },
      })
    ).revokedAt?.toISOString(),
    revokedAt.toISOString(),
  );

  await storePushSubscription({
    userId: owner.id,
    endpoint,
    p256dh: "resubscribed-p256dh",
    auth: "resubscribed-auth",
  });
  assert.equal(
    (await database.pushSubscription.findUniqueOrThrow({ where: { endpoint } })).revokedAt,
    null,
  );

  const quotaEndpoints = Array.from(
    { length: MAX_ACTIVE_PUSH_SUBSCRIPTIONS_PER_USER },
    (_, index) => `https://push.example.test/quota/${suffix}/${index}`,
  );
  for (const [index, quotaEndpoint] of quotaEndpoints.entries()) {
    await storePushSubscription({
      userId: quotaOwner.id,
      endpoint: quotaEndpoint,
      p256dh: `quota-p256dh-${index}`,
      auth: `quota-auth-${index}`,
    });
  }
  assert.equal(
    await database.pushSubscription.count({
      where: { userId: quotaOwner.id, revokedAt: null },
    }),
    MAX_ACTIVE_PUSH_SUBSCRIPTIONS_PER_USER,
  );

  await storePushSubscription({
    userId: quotaOwner.id,
    endpoint: quotaEndpoints[0]!,
    p256dh: "rotated-at-limit-p256dh",
    auth: "rotated-at-limit-auth",
  });
  assert.equal(
    (
      await database.pushSubscription.findUniqueOrThrow({
        where: { endpoint: quotaEndpoints[0] },
      })
    ).p256dh,
    "rotated-at-limit-p256dh",
  );

  const tombstoneEndpoint = `https://push.example.test/quota/${suffix}/old-revoked`;
  await database.pushSubscription.create({
    data: {
      userId: quotaOwner.id,
      endpoint: tombstoneEndpoint,
      p256dh: "old-p256dh",
      auth: "old-auth",
      revokedAt: new Date(),
    },
  });
  await assert.rejects(
    storePushSubscription({
      userId: quotaOwner.id,
      endpoint: `https://push.example.test/quota/${suffix}/over-limit`,
      p256dh: "over-limit-p256dh",
      auth: "over-limit-auth",
    }),
    PushSubscriptionLimitReachedError,
  );
  assert.equal(
    await database.pushSubscription.count({
      where: { userId: quotaOwner.id, revokedAt: { not: null } },
    }),
    0,
  );

  const reactivationEndpoint = `https://push.example.test/quota/${suffix}/reactivation`;
  await database.pushSubscription.create({
    data: {
      userId: quotaOwner.id,
      endpoint: reactivationEndpoint,
      p256dh: "revoked-p256dh",
      auth: "revoked-auth",
      revokedAt: new Date(),
    },
  });
  await assert.rejects(
    storePushSubscription({
      userId: quotaOwner.id,
      endpoint: reactivationEndpoint,
      p256dh: "reactivated-p256dh",
      auth: "reactivated-auth",
    }),
    PushSubscriptionLimitReachedError,
  );
  assert.ok(
    (
      await database.pushSubscription.findUniqueOrThrow({
        where: { endpoint: reactivationEndpoint },
      })
    ).revokedAt,
  );

  const concurrentBase = `https://push.example.test/concurrent-quota/${suffix}`;
  for (let index = 0; index < MAX_ACTIVE_PUSH_SUBSCRIPTIONS_PER_USER - 1; index += 1) {
    await storePushSubscription({
      userId: nextOwner.id,
      endpoint: `${concurrentBase}/existing-${index}`,
      p256dh: `concurrent-existing-p256dh-${index}`,
      auth: `concurrent-existing-auth-${index}`,
    });
  }
  const quotaRace = await Promise.allSettled(
    Array.from({ length: 4 }, (_, index) =>
      storePushSubscription({
        userId: nextOwner.id,
        endpoint: `${concurrentBase}/raced-${index}`,
        p256dh: `concurrent-raced-p256dh-${index}`,
        auth: `concurrent-raced-auth-${index}`,
      }),
    ),
  );
  assert.equal(quotaRace.filter(({ status }) => status === "fulfilled").length, 1);
  const rejectedQuotaWrites = quotaRace.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  assert.equal(rejectedQuotaWrites.length, 3);
  assert.ok(
    rejectedQuotaWrites.every(({ reason }) => reason instanceof PushSubscriptionLimitReachedError),
  );
  assert.equal(
    await database.pushSubscription.count({
      where: { userId: nextOwner.id, revokedAt: null },
    }),
    MAX_ACTIVE_PUSH_SUBSCRIPTIONS_PER_USER,
  );
} finally {
  await database.user.deleteMany({
    where: { id: { in: [owner.id, nextOwner.id, quotaOwner.id] } },
  });
  await database.$disconnect();
}

console.log("Push subscription integration checks passed.");
