import assert from "node:assert/strict";
import { createECDH } from "node:crypto";
import { describe, it } from "node:test";

import { loadVapidConfiguration, VapidConfigurationError } from "../src/vapid-config";

/**
 * Derives a deterministic, publicly known test vector. It is not generated
 * secret material and must never be used outside tests.
 */
function nonSecretTestPair(scalar = 1): {
  privateKey: string;
  publicKey: string;
} {
  const privateKey = Buffer.alloc(32);
  privateKey[31] = scalar;
  const keyAgreement = createECDH("prime256v1");
  keyAgreement.setPrivateKey(privateKey);
  return {
    privateKey: privateKey.toString("base64url"),
    publicKey: keyAgreement.getPublicKey(undefined, "uncompressed").toString("base64url"),
  };
}

describe("VAPID server configuration", () => {
  it("accepts a matching P-256 test vector and freezes the result", () => {
    const pair = nonSecretTestPair();
    const configuration = loadVapidConfiguration({
      VAPID_PRIVATE_KEY: pair.privateKey,
      VAPID_PUBLIC_KEY: pair.publicKey,
      VAPID_SUBJECT: "mailto:push-operations@example.test",
    });

    assert.deepEqual(configuration, {
      publicKey: pair.publicKey,
      subject: "mailto:push-operations@example.test",
    });
    assert.equal(configuration.privateKey, pair.privateKey);
    assert.equal(Object.keys(configuration).includes("privateKey"), false);
    assert.equal(JSON.stringify(configuration).includes(pair.privateKey), false);
    assert.equal(Object.isFrozen(configuration), true);
  });

  it("accepts an HTTPS contact subject", () => {
    const pair = nonSecretTestPair();
    assert.doesNotThrow(() =>
      loadVapidConfiguration({
        VAPID_PRIVATE_KEY: pair.privateKey,
        VAPID_PUBLIC_KEY: pair.publicKey,
        VAPID_SUBJECT: "https://athenvia.example/push-contact",
      }),
    );
  });

  it("rejects missing configuration without logging key material", () => {
    assert.throws(
      () => loadVapidConfiguration({}),
      (error: unknown) =>
        error instanceof VapidConfigurationError &&
        error.message === "VAPID_PUBLIC_KEY is required.",
    );
  });

  it("rejects public and private keys that do not form a pair", () => {
    const publicPair = nonSecretTestPair(1);
    const privatePair = nonSecretTestPair(2);

    assert.throws(
      () =>
        loadVapidConfiguration({
          VAPID_PRIVATE_KEY: privatePair.privateKey,
          VAPID_PUBLIC_KEY: publicPair.publicKey,
          VAPID_SUBJECT: "mailto:push-operations@example.test",
        }),
      /do not form a key pair/u,
    );
  });

  it("rejects malformed keys without copying their value into the error", () => {
    const marker = "PRIVATE_KEY_MUST_NEVER_APPEAR_IN_ERRORS";
    const pair = nonSecretTestPair();

    assert.throws(
      () =>
        loadVapidConfiguration({
          VAPID_PRIVATE_KEY: marker,
          VAPID_PUBLIC_KEY: pair.publicKey,
          VAPID_SUBJECT: "mailto:push-operations@example.test",
        }),
      (error: unknown) =>
        error instanceof VapidConfigurationError && !error.message.includes(marker),
    );
  });

  for (const subject of [
    "http://athenvia.example/push-contact",
    "ftp://athenvia.example/push-contact",
    "mailto:not-an-address",
    "mailto:@",
    "mailto:first@example.test,second@example.test",
    "not a subject",
  ]) {
    it(`rejects an unsupported VAPID subject: ${subject}`, () => {
      const pair = nonSecretTestPair();

      assert.throws(() =>
        loadVapidConfiguration({
          VAPID_PRIVATE_KEY: pair.privateKey,
          VAPID_PUBLIC_KEY: pair.publicKey,
          VAPID_SUBJECT: subject,
        }),
      );
    });
  }
});
