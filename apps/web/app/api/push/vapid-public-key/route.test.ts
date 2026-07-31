import { createECDH } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { loadPublicVapidKey } from "./public-key";
import { GET } from "./route";

/**
 * Uses a deterministic, publicly known scalar. This is a test vector, not
 * generated secret material.
 */
function nonSecretTestPublicKey(): string {
  const privateKey = Buffer.alloc(32);
  privateKey[31] = 3;
  const keyAgreement = createECDH("prime256v1");
  keyAgreement.setPrivateKey(privateKey);
  return keyAgreement.getPublicKey(undefined, "uncompressed").toString("base64url");
}

describe("public VAPID key boundary", () => {
  const initialPublicKey = process.env.VAPID_PUBLIC_KEY;
  const initialPrivateKey = process.env.VAPID_PRIVATE_KEY;

  afterEach(() => {
    vi.restoreAllMocks();
    if (initialPublicKey === undefined) {
      delete process.env.VAPID_PUBLIC_KEY;
    } else {
      process.env.VAPID_PUBLIC_KEY = initialPublicKey;
    }
    if (initialPrivateKey === undefined) {
      delete process.env.VAPID_PRIVATE_KEY;
    } else {
      process.env.VAPID_PRIVATE_KEY = initialPrivateKey;
    }
  });

  it("validates an uncompressed P-256 public key", () => {
    const publicKey = nonSecretTestPublicKey();
    expect(loadPublicVapidKey(publicKey)).toBe(publicKey);
  });

  it.each([undefined, "", "not-base64url!", Buffer.alloc(32).toString("base64url")])(
    "rejects an invalid public key without a response payload",
    (publicKey) => {
      expect(() => loadPublicVapidKey(publicKey)).toThrow();
    },
  );

  it("returns only the public key and never reads the private value into JSON", async () => {
    const publicKey = nonSecretTestPublicKey();
    const privateMarker = "PRIVATE_KEY_RESPONSE_LEAK_MARKER";
    process.env.VAPID_PUBLIC_KEY = publicKey;
    process.env.VAPID_PRIVATE_KEY = privateMarker;

    const response = GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual({ publicKey });
    expect(JSON.stringify(body)).not.toContain(privateMarker);
  });

  it("fails closed with a generic response when public configuration is invalid", async () => {
    process.env.VAPID_PUBLIC_KEY = "invalid";

    const response = GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({
      error: {
        code: "PUSH_CONFIGURATION_UNAVAILABLE",
        message: "Push notifications are not available right now.",
      },
    });
    expect(JSON.stringify(body)).not.toContain("invalid");
  });
});
