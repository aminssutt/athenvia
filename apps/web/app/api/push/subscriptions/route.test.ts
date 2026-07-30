import { createECDH } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  LimitReachedError: class LimitReachedError extends Error {},
  OwnershipConflictError: class OwnershipConflictError extends Error {},
  getServerSession: vi.fn(),
  revokePushSubscription: vi.fn(),
  storePushSubscription: vi.fn(),
  userFindUnique: vi.fn(),
}));

vi.mock("@athenvia/database", () => ({
  database: {
    user: {
      findUnique: mocks.userFindUnique,
    },
  },
  revokePushSubscription: mocks.revokePushSubscription,
  storePushSubscription: mocks.storePushSubscription,
  PushSubscriptionLimitReachedError: mocks.LimitReachedError,
  PushSubscriptionOwnershipConflictError: mocks.OwnershipConflictError,
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

import { DELETE, POST } from "./route";

const userId = "11111111-1111-4111-8111-111111111111";
const endpoint = "https://push.example.test/subscriptions/browser-1?token=opaque";
const auth = Buffer.alloc(16, 7).toString("base64url");

function p256dh(): string {
  const privateKey = Buffer.alloc(32);
  privateKey[31] = 5;
  const agreement = createECDH("prime256v1");
  agreement.setPrivateKey(privateKey);
  return agreement.getPublicKey(undefined, "uncompressed").toString("base64url");
}

function mutationRequest(
  method: "DELETE" | "POST",
  body: unknown,
  origin = "https://athenvia.test",
) {
  return new Request("https://athenvia.test/api/push/subscriptions", {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      "Sec-Fetch-Site": "same-origin",
      "User-Agent": "Test Browser/1.0",
    },
    body: JSON.stringify(body),
  });
}

describe("authenticated push subscription mutations", () => {
  const initialNextAuthUrl = process.env.NEXTAUTH_URL;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.storePushSubscription.mockResolvedValue(undefined);
    mocks.revokePushSubscription.mockResolvedValue(undefined);
    delete process.env.NEXTAUTH_URL;
    mocks.getServerSession.mockResolvedValue({
      user: { email: "student@example.test" },
    });
    mocks.userFindUnique.mockResolvedValue({ id: userId });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (initialNextAuthUrl === undefined) {
      delete process.env.NEXTAUTH_URL;
    } else {
      process.env.NEXTAUTH_URL = initialNextAuthUrl;
    }
  });

  it("rejects a cross-site mutation before resolving the session", async () => {
    const response = await POST(
      mutationRequest(
        "POST",
        { endpoint, keys: { auth, p256dh: p256dh() } },
        "https://attacker.test",
      ),
    );

    expect(response.status).toBe(403);
    expect(mocks.getServerSession).not.toHaveBeenCalled();
    expect(mocks.storePushSubscription).not.toHaveBeenCalled();
  });

  it("requires a database-backed authenticated owner", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const response = await POST(
      mutationRequest("POST", { endpoint, keys: { auth, p256dh: p256dh() } }),
    );

    expect(response.status).toBe(401);
    expect(mocks.storePushSubscription).not.toHaveBeenCalled();
  });

  it("fails closed with private headers when owner lookup is unavailable", async () => {
    const privateMarker = "DATABASE_ERROR_MUST_NOT_BE_LOGGED";
    mocks.userFindUnique.mockRejectedValue(new Error(privateMarker));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(
      mutationRequest("POST", { endpoint, keys: { auth, p256dh: p256dh() } }),
    );
    const serialized = await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(serialized).not.toContain(endpoint);
    expect(serialized).not.toContain(auth);
    expect(JSON.stringify(log.mock.calls)).not.toContain(privateMarker);
    expect(mocks.storePushSubscription).not.toHaveBeenCalled();
  });

  it("rejects non-JSON mutations before resolving a session", async () => {
    const request = mutationRequest("POST", {
      endpoint,
      keys: { auth, p256dh: p256dh() },
    });
    request.headers.set("content-type", "text/plain");

    const response = await POST(request);

    expect(response.status).toBe(415);
    expect(mocks.getServerSession).not.toHaveBeenCalled();
  });

  it.each([
    {
      endpoint: "http://push.example.test/subscription",
      keys: { auth, p256dh: p256dh() },
    },
    {
      endpoint: "https://user:password@push.example.test/subscription",
      keys: { auth, p256dh: p256dh() },
    },
    {
      endpoint: "https://push.example.test/subscription#secret",
      keys: { auth, p256dh: p256dh() },
    },
    {
      endpoint: "https://localhost/subscription",
      keys: { auth, p256dh: p256dh() },
    },
    {
      endpoint: "https://localhost./subscription",
      keys: { auth, p256dh: p256dh() },
    },
    {
      endpoint: "https://device.local/subscription",
      keys: { auth, p256dh: p256dh() },
    },
    {
      endpoint: "https://pushgateway/subscription",
      keys: { auth, p256dh: p256dh() },
    },
    {
      endpoint: "https://127.0.0.1/subscription",
      keys: { auth, p256dh: p256dh() },
    },
    {
      endpoint: `https://push.example.test/${"a".repeat(4_100)}`,
      keys: { auth, p256dh: p256dh() },
    },
    {
      endpoint,
      keys: { auth: `${auth}=`, p256dh: p256dh() },
    },
    {
      endpoint,
      keys: { auth, p256dh: Buffer.alloc(64).toString("base64url") },
    },
    {
      endpoint,
      keys: {
        auth,
        p256dh: Buffer.concat([Buffer.from([0x04]), Buffer.alloc(64)]).toString("base64url"),
      },
    },
    {
      endpoint,
      keys: { auth, p256dh: p256dh() },
      userId,
    },
  ])("rejects malformed or ownership-bearing subscription input", async (body) => {
    const response = await POST(mutationRequest("POST", body));

    expect(response.status).toBe(400);
    expect(mocks.storePushSubscription).not.toHaveBeenCalled();
  });

  it("accepts the native expirationTime field but stores only server-owned metadata", async () => {
    const publicKey = p256dh();
    const response = await POST(
      mutationRequest("POST", {
        endpoint,
        expirationTime: null,
        keys: {
          auth,
          p256dh: publicKey,
        },
      }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.text()).toBe("");
    expect(mocks.storePushSubscription).toHaveBeenCalledWith({
      userId,
      endpoint,
      p256dh: publicKey,
      auth,
      userAgent: "Test Browser/1.0",
    });
  });

  it("canonicalizes equivalent endpoints before deduplication", async () => {
    const response = await POST(
      mutationRequest("POST", {
        endpoint: "https://PUSH.EXAMPLE.TEST.:443/a/../subscriptions/browser-1",
        keys: { auth, p256dh: p256dh() },
      }),
    );

    expect(response.status).toBe(204);
    expect(mocks.storePushSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: "https://push.example.test/subscriptions/browser-1",
      }),
    );
  });

  it("revokes by authenticated owner and returns the same empty success for every outcome", async () => {
    mocks.revokePushSubscription.mockResolvedValue(undefined);

    const response = await DELETE(mutationRequest("DELETE", { endpoint }));

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(mocks.revokePushSubscription).toHaveBeenCalledWith(userId, endpoint);
  });

  it("returns a generic conflict without exposing a foreign-owned endpoint", async () => {
    mocks.storePushSubscription.mockRejectedValue(new mocks.OwnershipConflictError());

    const response = await POST(
      mutationRequest("POST", {
        endpoint,
        keys: { auth, p256dh: p256dh() },
      }),
    );
    const serialized = await response.text();

    expect(response.status).toBe(409);
    expect(serialized).not.toContain(endpoint);
    expect(serialized).not.toContain(auth);
  });

  it("maps the per-user limit to the same generic secret-free conflict", async () => {
    mocks.storePushSubscription.mockRejectedValue(new mocks.LimitReachedError());

    const response = await POST(
      mutationRequest("POST", {
        endpoint,
        keys: { auth, p256dh: p256dh() },
      }),
    );
    const serialized = await response.text();

    expect(response.status).toBe(409);
    expect(serialized).not.toContain(endpoint);
    expect(serialized).not.toContain(auth);
    expect(JSON.parse(serialized)).toEqual({
      error: {
        code: "PUSH_SUBSCRIPTION_CONFLICT",
        message: "This push subscription cannot be registered for this account.",
      },
    });
  });

  it("does not serialize or log endpoint and key material when storage fails", async () => {
    const publicKey = p256dh();
    const secretMarker = `${endpoint}:${publicKey}:${auth}`;
    mocks.storePushSubscription.mockRejectedValue(new Error(secretMarker));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(
      mutationRequest("POST", {
        endpoint,
        keys: { auth, p256dh: publicKey },
      }),
    );
    const serialized = await response.text();

    expect(response.status).toBe(503);
    expect(serialized).not.toContain(endpoint);
    expect(serialized).not.toContain(publicKey);
    expect(serialized).not.toContain(auth);
    expect(JSON.stringify(log.mock.calls)).not.toContain(secretMarker);
  });
});
