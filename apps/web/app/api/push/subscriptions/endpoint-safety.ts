import { lookup } from "node:dns/promises";

import {
  isPublicNetworkAddress,
  type WebsiteAddressResolver,
} from "../../university-submissions/safe-url";

const DNS_TIMEOUT_MS = 1_500;
const MAX_RESOLVED_ADDRESSES = 32;

const defaultResolver: WebsiteAddressResolver = (hostname) =>
  lookup(hostname, { all: true, order: "verbatim" });

async function resolveWithTimeout(resolver: WebsiteAddressResolver, hostname: string) {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      resolver(hostname),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Push endpoint DNS verification timed out.")),
          DNS_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

/**
 * Resolves the push endpoint hostname and requires every address to be public,
 * mirroring the university-website SSRF guard in
 * `../../university-submissions/safe-url.ts`. A user-controlled endpoint that
 * resolves to loopback, link-local, or private ranges would otherwise let the
 * worker POST toward internal hosts when a notification fires. DNS can change
 * between registration and delivery, so the worker re-validates at send time;
 * this check keeps obviously hostile endpoints out of the database.
 */
export async function resolvesToPublicAddresses(
  endpoint: string,
  resolver: WebsiteAddressResolver = defaultResolver,
): Promise<boolean> {
  let hostname: string;
  try {
    hostname = new URL(endpoint).hostname.replace(/^\[|\]$/g, "");
  } catch {
    return false;
  }

  try {
    const addresses = await resolveWithTimeout(resolver, hostname);
    return (
      addresses.length > 0 &&
      addresses.length <= MAX_RESOLVED_ADDRESSES &&
      addresses.every(({ address }) => isPublicNetworkAddress(address))
    );
  } catch {
    return false;
  }
}
