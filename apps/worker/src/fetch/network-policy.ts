import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

import { OfficialSourceFetchError } from "./errors";

const unsafeIpv4Ranges: ReadonlyArray<readonly [number, number, number]> = [
  [0x00000000, 8, 0], // current network
  [0x0a000000, 8, 0], // private
  [0x64400000, 10, 0], // carrier-grade NAT
  [0x7f000000, 8, 0], // loopback
  [0xa9fe0000, 16, 0], // link-local
  [0xac100000, 12, 0], // private
  [0xc0000000, 24, 0], // IETF protocol assignments
  [0xc0000200, 24, 0], // documentation
  [0xc0586300, 24, 0], // deprecated 6to4 relay
  [0xc0a80000, 16, 0], // private
  [0xc6120000, 15, 0], // benchmark
  [0xc6336400, 24, 0], // documentation
  [0xcb007100, 24, 0], // documentation
  [0xe0000000, 4, 0], // multicast
  [0xf0000000, 4, 0], // reserved and broadcast
];

const unsafeIpv6Ranges = new BlockList();
unsafeIpv6Ranges.addSubnet("64:ff9b::", 96, "ipv6");
unsafeIpv6Ranges.addSubnet("64:ff9b:1::", 48, "ipv6");
unsafeIpv6Ranges.addSubnet("2001::", 32, "ipv6");
unsafeIpv6Ranges.addSubnet("2001:2::", 48, "ipv6");
unsafeIpv6Ranges.addSubnet("2001:db8::", 32, "ipv6");
unsafeIpv6Ranges.addSubnet("2002::", 16, "ipv6");

function ipv4Number(address: string): number | null {
  const octets = address.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return null;
  }

  return (
    (((octets[0] ?? 0) << 24) |
      ((octets[1] ?? 0) << 16) |
      ((octets[2] ?? 0) << 8) |
      (octets[3] ?? 0)) >>>
    0
  );
}

function ipv4InCidr(value: number, network: number, prefix: number): boolean {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (network & mask);
}

function mappedIpv4(address: string): string | null {
  const normalized = address.toLowerCase();
  if (!normalized.startsWith("::ffff:")) {
    return null;
  }

  const suffix = normalized.slice("::ffff:".length);
  if (isIP(suffix) === 4) {
    return suffix;
  }

  const words = suffix.split(":");
  if (words.length !== 2 || words.some((word) => !/^[0-9a-f]{1,4}$/u.test(word))) {
    return null;
  }

  const high = Number.parseInt(words[0] ?? "", 16);
  const low = Number.parseInt(words[1] ?? "", 16);
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);

  if (family === 4) {
    const value = ipv4Number(address);
    return (
      value !== null &&
      !unsafeIpv4Ranges.some(([network, prefix]) => ipv4InCidr(value, network, prefix))
    );
  }

  if (family === 6) {
    const mapped = mappedIpv4(address);
    if (mapped) {
      return isPublicAddress(mapped);
    }

    const firstWord = Number.parseInt(address.split(":")[0] ?? "", 16);
    // Public global-unicast space is currently 2000::/3. Reject transition,
    // local, multicast and future-use ranges until they are reviewed explicitly.
    return (
      Number.isFinite(firstWord) &&
      firstWord >= 0x2000 &&
      firstWord <= 0x3fff &&
      !unsafeIpv6Ranges.check(address, "ipv6")
    );
  }

  return false;
}

export type HostResolver = (hostname: string) => Promise<string[]>;

export const systemHostResolver: HostResolver = async (hostname) => {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return [...new Set(records.map(({ address }) => address))];
};

function normalizeApprovedHost(value: string): string {
  const candidate = value.includes("://") ? value : `https://${value}`;

  try {
    const parsed = new URL(candidate);
    if (
      !parsed.hostname ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      throw new Error("Host entries must not contain credentials, paths, queries, or fragments.");
    }
    return parsed.hostname.toLowerCase();
  } catch {
    throw new OfficialSourceFetchError(
      "INVALID_TARGET",
      `Invalid approved official host: ${value}`,
    );
  }
}

export class OfficialDomainPolicy {
  private readonly approvedHosts: ReadonlySet<string>;

  constructor(approvedHosts: readonly string[]) {
    this.approvedHosts = new Set(approvedHosts.map(normalizeApprovedHost));
    if (this.approvedHosts.size === 0) {
      throw new OfficialSourceFetchError(
        "DOMAIN_NOT_APPROVED",
        "At least one official host must be approved.",
      );
    }
  }

  approvedHostnames(): string[] {
    return [...this.approvedHosts];
  }

  parseTarget(value: string | URL): URL {
    let target: URL;

    try {
      target = value instanceof URL ? new URL(value) : new URL(value);
    } catch {
      throw new OfficialSourceFetchError("INVALID_TARGET", "Source URL is invalid.");
    }

    if (
      !["http:", "https:"].includes(target.protocol) ||
      target.username ||
      target.password ||
      (target.port &&
        !(
          (target.protocol === "http:" && target.port === "80") ||
          (target.protocol === "https:" && target.port === "443")
        ))
    ) {
      throw new OfficialSourceFetchError(
        "INVALID_TARGET",
        "Source URL must use HTTP(S), standard ports, and no credentials.",
      );
    }

    const hostname = target.hostname.toLowerCase();
    if (isIP(hostname) !== 0 || !this.approvedHosts.has(hostname)) {
      throw new OfficialSourceFetchError(
        "DOMAIN_NOT_APPROVED",
        "Source host is not an explicitly approved official domain.",
        { hostname },
      );
    }

    return target;
  }

  async resolvePublicTarget(target: URL, resolver: HostResolver): Promise<string[]> {
    const addresses = await resolver(target.hostname);
    if (addresses.length === 0 || addresses.some((address) => !isPublicAddress(address))) {
      throw new OfficialSourceFetchError(
        "PRIVATE_TARGET",
        "Official source resolved to a private, local, reserved, or invalid address.",
        { hostname: target.hostname },
      );
    }
    return addresses;
  }
}
