import { isIP } from "node:net";

import { isPublicAddress, systemHostResolver, type HostResolver } from "./fetch/network-policy";

const MAX_RESOLVED_ADDRESSES = 32;

/**
 * The stored endpoint targets a non-public network address (or is malformed).
 * Classified as an invalid subscription so the caller revokes it and the
 * worker never POSTs toward internal hosts.
 */
export class UnsafePushEndpointError extends Error {
  constructor() {
    super("The push endpoint targets a non-public network address.");
    this.name = "UnsafePushEndpointError";
  }
}

/**
 * The endpoint hostname could not be resolved right now. No request was made,
 * so a retry is safe and must not revoke the subscription.
 */
export class PushEndpointResolutionError extends Error {
  constructor() {
    super("The push endpoint hostname could not be resolved.");
    this.name = "PushEndpointResolutionError";
  }
}

/**
 * SSRF guard for user-controlled Web Push endpoints, mirroring the official
 * source fetch path (`fetch/network-policy.ts`). Push services are ordinary
 * public HTTPS hosts, so instead of a strict allowlist the endpoint hostname
 * is resolved and every address must be public. The check runs at send time —
 * not only at registration — because DNS can change (or be rebound) between
 * the two.
 */
export async function assertSafePushEndpoint(
  endpoint: string,
  resolver: HostResolver = systemHostResolver,
): Promise<void> {
  let target: URL;
  try {
    target = new URL(endpoint);
  } catch {
    throw new UnsafePushEndpointError();
  }

  const hostname = target.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    target.protocol !== "https:" ||
    target.username !== "" ||
    target.password !== "" ||
    !hostname.includes(".") ||
    isIP(hostname) !== 0
  ) {
    throw new UnsafePushEndpointError();
  }

  let addresses: readonly string[];
  try {
    addresses = await resolver(target.hostname);
  } catch {
    throw new PushEndpointResolutionError();
  }

  if (
    addresses.length === 0 ||
    addresses.length > MAX_RESOLVED_ADDRESSES ||
    addresses.some((address) => !isPublicAddress(address))
  ) {
    throw new UnsafePushEndpointError();
  }
}
