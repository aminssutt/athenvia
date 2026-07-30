import { createECDH, timingSafeEqual } from "node:crypto";

export type VapidConfiguration = Readonly<{
  privateKey: string;
  publicKey: string;
  subject: string;
}>;

export class VapidConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VapidConfigurationError";
  }
}

function requiredEnvironmentValue(
  environment: NodeJS.ProcessEnv,
  name: "VAPID_PRIVATE_KEY" | "VAPID_PUBLIC_KEY" | "VAPID_SUBJECT",
): string {
  const value = environment[name];
  if (!value) {
    throw new VapidConfigurationError(`${name} is required.`);
  }
  if (value !== value.trim()) {
    throw new VapidConfigurationError(`${name} must not contain surrounding whitespace.`);
  }

  return value;
}

function decodeCanonicalBase64Url(
  name: "VAPID_PRIVATE_KEY" | "VAPID_PUBLIC_KEY",
  value: string,
  expectedBytes: number,
): Buffer {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new VapidConfigurationError(`${name} must be unpadded base64url.`);
  }

  const decoded = Buffer.from(value, "base64url");
  if (decoded.length !== expectedBytes || decoded.toString("base64url") !== value) {
    throw new VapidConfigurationError(`${name} does not have the expected P-256 key encoding.`);
  }

  return decoded;
}

function validateSubject(subject: string): void {
  let url: URL;
  try {
    url = new URL(subject);
  } catch {
    throw new VapidConfigurationError("VAPID_SUBJECT must be a mailto: address or HTTPS URL.");
  }

  const validMailto =
    url.protocol === "mailto:" &&
    /^[^@\s,]+@[^@\s,]+\.[^@\s,]+$/u.test(url.pathname) &&
    !url.search &&
    !url.hash;
  const validHttps =
    url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;

  if (!validMailto && !validHttps) {
    throw new VapidConfigurationError("VAPID_SUBJECT must be a mailto: address or HTTPS URL.");
  }
}

/**
 * Loads the complete VAPID key pair for server-side notification delivery.
 *
 * Keep this module inside the worker boundary. Errors deliberately identify
 * variable names and validation rules without including key material.
 */
export function loadVapidConfiguration(environment: NodeJS.ProcessEnv): VapidConfiguration {
  const publicKey = requiredEnvironmentValue(environment, "VAPID_PUBLIC_KEY");
  const privateKey = requiredEnvironmentValue(environment, "VAPID_PRIVATE_KEY");
  const subject = requiredEnvironmentValue(environment, "VAPID_SUBJECT");

  const publicKeyBytes = decodeCanonicalBase64Url("VAPID_PUBLIC_KEY", publicKey, 65);
  if (publicKeyBytes[0] !== 0x04) {
    throw new VapidConfigurationError("VAPID_PUBLIC_KEY must be an uncompressed P-256 public key.");
  }
  const privateKeyBytes = decodeCanonicalBase64Url("VAPID_PRIVATE_KEY", privateKey, 32);

  let derivedPublicKey: Buffer;
  try {
    const keyAgreement = createECDH("prime256v1");
    keyAgreement.setPrivateKey(privateKeyBytes);
    derivedPublicKey = keyAgreement.getPublicKey(undefined, "uncompressed");
  } catch {
    throw new VapidConfigurationError("VAPID_PRIVATE_KEY is not a valid P-256 private key.");
  }

  if (
    derivedPublicKey.length !== publicKeyBytes.length ||
    !timingSafeEqual(derivedPublicKey, publicKeyBytes)
  ) {
    throw new VapidConfigurationError(
      "VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY do not form a key pair.",
    );
  }

  validateSubject(subject);

  const configuration = {
    publicKey,
    subject,
  } as VapidConfiguration;
  Object.defineProperty(configuration, "privateKey", {
    configurable: false,
    enumerable: false,
    value: privateKey,
    writable: false,
  });

  return Object.freeze(configuration);
}
