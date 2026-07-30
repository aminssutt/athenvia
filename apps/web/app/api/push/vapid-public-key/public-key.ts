export class PublicVapidKeyConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublicVapidKeyConfigurationError";
  }
}

/**
 * Loads only the public half of the VAPID pair for the browser boundary.
 *
 * This module intentionally has no knowledge of VAPID_PRIVATE_KEY.
 */
export function loadPublicVapidKey(publicKey: string | undefined): string {
  if (!publicKey) {
    throw new PublicVapidKeyConfigurationError("VAPID_PUBLIC_KEY is not configured.");
  }
  if (publicKey !== publicKey.trim() || !/^[A-Za-z0-9_-]+$/u.test(publicKey)) {
    throw new PublicVapidKeyConfigurationError("VAPID_PUBLIC_KEY must be unpadded base64url.");
  }

  const decoded = Buffer.from(publicKey, "base64url");
  if (decoded.length !== 65 || decoded[0] !== 0x04 || decoded.toString("base64url") !== publicKey) {
    throw new PublicVapidKeyConfigurationError(
      "VAPID_PUBLIC_KEY is not an uncompressed P-256 public key.",
    );
  }

  return publicKey;
}
