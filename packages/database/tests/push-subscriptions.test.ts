import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_ACTIVE_PUSH_SUBSCRIPTIONS_PER_USER,
  PushSubscriptionLimitReachedError,
  PushSubscriptionOwnershipConflictError,
  revokePushSubscription,
  storePushSubscription,
} from "../src/push-subscriptions";

const firstUserId = "11111111-1111-4111-8111-111111111111";
const secondUserId = "22222222-2222-4222-8222-222222222222";
const endpoint = "https://push.example.test/subscriptions/browser-1";

type FakeOverrides = {
  activeCount?: number;
  create?: () => Promise<unknown>;
  findResults?: Array<{ revokedAt: Date | null; userId: string } | null>;
};

function transactionalClient(overrides: FakeOverrides = {}) {
  const operations: Array<{ args?: unknown[]; name: string; value?: unknown }> = [];
  const findResults = [...(overrides.findResults ?? [null])];
  let transactionCalls = 0;

  const transaction = {
    $executeRaw: async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      operations.push({ name: "lock", args: values });
      return 1;
    },
    pushSubscription: {
      findUnique: async (value: unknown) => {
        operations.push({ name: "findUnique", value });
        return findResults.shift() ?? null;
      },
      updateMany: async (value: unknown) => {
        operations.push({ name: "updateMany", value });
        return { count: 1 };
      },
      deleteMany: async (value: unknown) => {
        operations.push({ name: "deleteMany", value });
        return { count: 0 };
      },
      count: async (value: unknown) => {
        operations.push({ name: "count", value });
        return overrides.activeCount ?? 0;
      },
      create: async (value: unknown) => {
        operations.push({ name: "create", value });
        return overrides.create ? overrides.create() : { id: "subscription-1" };
      },
    },
  };

  const client = {
    $transaction: async (callback: (value: typeof transaction) => Promise<unknown>) => {
      transactionCalls += 1;
      return callback(transaction);
    },
  } as never;

  return {
    client,
    operations,
    transactionCalls: () => transactionCalls,
  };
}

test("serializes a create, purges revoked tombstones, and stores no selected secrets", async () => {
  const fake = transactionalClient();

  await storePushSubscription(
    {
      userId: secondUserId,
      endpoint,
      p256dh: "new-p256dh",
      auth: "new-auth",
      userAgent: "Test Browser",
    },
    fake.client,
  );

  assert.equal(fake.transactionCalls(), 1);
  assert.deepEqual(
    fake.operations.map(({ name }) => name),
    ["lock", "findUnique", "deleteMany", "count", "create"],
  );
  assert.deepEqual(fake.operations[0]?.args, [`push-subscriptions:${secondUserId}`]);
  assert.deepEqual(fake.operations[2]?.value, {
    where: {
      userId: secondUserId,
      revokedAt: { not: null },
    },
  });
  assert.deepEqual(fake.operations[3]?.value, {
    where: {
      userId: secondUserId,
      revokedAt: null,
    },
  });
  assert.deepEqual(fake.operations[4]?.value, {
    data: {
      userId: secondUserId,
      endpoint,
      p256dh: "new-p256dh",
      auth: "new-auth",
      userAgent: "Test Browser",
    },
    select: { id: true },
  });
});

test("rotates an active owned endpoint before enforcing the active limit", async () => {
  const fake = transactionalClient({
    activeCount: MAX_ACTIVE_PUSH_SUBSCRIPTIONS_PER_USER,
    findResults: [{ userId: firstUserId, revokedAt: null }],
  });

  await storePushSubscription(
    {
      userId: firstUserId,
      endpoint,
      p256dh: "rotated-p256dh",
      auth: "rotated-auth",
    },
    fake.client,
  );

  assert.deepEqual(
    fake.operations.map(({ name }) => name),
    ["lock", "findUnique", "updateMany"],
  );
  assert.deepEqual(fake.operations[2]?.value, {
    where: { endpoint, userId: firstUserId },
    data: {
      p256dh: "rotated-p256dh",
      auth: "rotated-auth",
      userAgent: undefined,
      revokedAt: null,
    },
  });
});

test("commits tombstone cleanup but refuses a new endpoint at the active limit", async () => {
  const fake = transactionalClient({
    activeCount: MAX_ACTIVE_PUSH_SUBSCRIPTIONS_PER_USER,
  });

  await assert.rejects(
    storePushSubscription(
      {
        userId: firstUserId,
        endpoint,
        p256dh: "limited-p256dh",
        auth: "limited-auth",
      },
      fake.client,
    ),
    PushSubscriptionLimitReachedError,
  );

  assert.deepEqual(
    fake.operations.map(({ name }) => name),
    ["lock", "findUnique", "deleteMany", "count"],
  );
});

test("refuses reactivation when ten other subscriptions are already active", async () => {
  const fake = transactionalClient({
    activeCount: MAX_ACTIVE_PUSH_SUBSCRIPTIONS_PER_USER,
    findResults: [{ userId: firstUserId, revokedAt: new Date("2026-07-30T12:00:00Z") }],
  });

  await assert.rejects(
    storePushSubscription(
      {
        userId: firstUserId,
        endpoint,
        p256dh: "reactivated-p256dh",
        auth: "reactivated-auth",
      },
      fake.client,
    ),
    PushSubscriptionLimitReachedError,
  );

  assert.deepEqual(
    fake.operations.map(({ name }) => name),
    ["lock", "findUnique", "count"],
  );
});

test("retries the complete transaction after a same-owner unique race", async () => {
  const fake = transactionalClient({
    create: async () => {
      throw { code: "P2002" };
    },
    findResults: [null, { userId: firstUserId, revokedAt: null }],
  });

  await storePushSubscription(
    {
      userId: firstUserId,
      endpoint,
      p256dh: "raced-p256dh",
      auth: "raced-auth",
    },
    fake.client,
  );

  assert.deepEqual(
    fake.operations.map(({ name }) => name),
    ["lock", "findUnique", "deleteMany", "count", "create", "lock", "findUnique", "updateMany"],
  );
  assert.equal(fake.transactionCalls(), 2);
});

test("detects a cross-user unique race on the complete transaction retry", async () => {
  const fake = transactionalClient({
    create: async () => {
      throw { code: "P2002" };
    },
    findResults: [null, { userId: firstUserId, revokedAt: null }],
  });

  await assert.rejects(
    storePushSubscription(
      {
        userId: secondUserId,
        endpoint,
        p256dh: "foreign-p256dh",
        auth: "foreign-auth",
      },
      fake.client,
    ),
    PushSubscriptionOwnershipConflictError,
  );
  assert.equal(fake.transactionCalls(), 2);
});

test("revokes only an active endpoint owned by the authenticated user", async () => {
  const writes: Array<{ data: { revokedAt: Date }; where: unknown }> = [];
  const client = {
    pushSubscription: {
      updateMany: async (args: { data: { revokedAt: Date }; where: unknown }) => {
        writes.push(args);
        return { count: 0 };
      },
    },
  } as never;

  const result = await revokePushSubscription(firstUserId, endpoint, client);

  assert.equal(result, undefined);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0]?.where, {
    userId: firstUserId,
    endpoint,
    revokedAt: null,
  });
  assert.ok(writes[0]?.data.revokedAt instanceof Date);
});
