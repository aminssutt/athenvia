import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const DNS_TIMEOUT_MS = 1_500;
const DNS_VERIFICATION_PASSES = 2;
const BLOCKED_HOSTNAME_SUFFIXES = [
  ".home",
  ".internal",
  ".invalid",
  ".lan",
  ".local",
  ".localhost",
  ".onion",
  ".test",
] as const;

export type ResolvedAddress = {
  address: string;
  family: number;
};

export type WebsiteAddressResolver = (hostname: string) => Promise<readonly ResolvedAddress[]>;

export class UnsafeOfficialWebsiteError extends Error {
  constructor(message = "The official website could not be verified safely.") {
    super(message);
    this.name = "UnsafeOfficialWebsiteError";
  }
}

const defaultResolver: WebsiteAddressResolver = (hostname) =>
  lookup(hostname, { all: true, order: "verbatim" });

function isBlockedHostname(hostname: string) {
  const normalizedHostname = hostname.toLocaleLowerCase("en").replace(/\.$/, "");

  return (
    !normalizedHostname.includes(".") ||
    normalizedHostname === "localhost" ||
    BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => normalizedHostname.endsWith(suffix))
  );
}

function isPublicIpv4(address: string) {
  const octets = address.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return false;
  }

  const [first = 0, second = 0, third = 0] = octets;

  if (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && third === 0) ||
    (first === 192 && second === 0 && third === 2) ||
    (first === 192 && second === 88 && third === 99) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224
  ) {
    return false;
  }

  return true;
}

function ipv6Words(address: string): number[] | null {
  let normalized = address.toLocaleLowerCase("en").split("%")[0] ?? "";

  if (normalized.includes(".")) {
    const lastColon = normalized.lastIndexOf(":");
    const ipv4 = normalized.slice(lastColon + 1);
    if (!isIP(ipv4)) {
      return null;
    }
    const octets = ipv4.split(".").map(Number);
    normalized = `${normalized.slice(0, lastColon)}:${(
      ((octets[0] ?? 0) << 8) |
      (octets[1] ?? 0)
    ).toString(16)}:${(((octets[2] ?? 0) << 8) | (octets[3] ?? 0)).toString(16)}`;
  }

  const halves = normalized.split("::");
  if (halves.length > 2) {
    return null;
  }

  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;

  if ((halves.length === 1 && missing !== 0) || missing < 0) {
    return null;
  }

  const words = [...left, ...Array.from({ length: missing }, () => "0"), ...right].map((part) =>
    Number.parseInt(part || "0", 16),
  );

  return words.length === 8 &&
    words.every((word) => Number.isInteger(word) && word >= 0 && word <= 0xffff)
    ? words
    : null;
}

function isPublicIpv6(address: string) {
  const words = ipv6Words(address);
  if (!words) {
    return false;
  }

  const [first = 0, second = 0, third = 0, fourth = 0, fifth = 0, sixth = 0] = words;
  const isUnspecifiedOrLoopback =
    words.slice(0, 7).every((word) => word === 0) && (words[7] === 0 || words[7] === 1);
  const isIpv4Compatible =
    first === 0 && second === 0 && third === 0 && fourth === 0 && fifth === 0;

  if (isIpv4Compatible && sixth === 0xffff) {
    const mappedAddress = `${words[6] >> 8}.${words[6] & 0xff}.${words[7] >> 8}.${words[7] & 0xff}`;
    return isPublicIpv4(mappedAddress);
  }

  return !(
    isUnspecifiedOrLoopback ||
    (isIpv4Compatible && sixth === 0) ||
    (first === 0x0064 && second === 0xff9b) ||
    first === 0x0100 ||
    (first === 0x2001 && second < 0x0200) ||
    (first & 0xfe00) === 0xfc00 ||
    (first & 0xffc0) === 0xfe80 ||
    (first & 0xffc0) === 0xfec0 ||
    (first & 0xff00) === 0xff00 ||
    (first === 0x2001 && second === 0x0db8) ||
    first === 0x2002 ||
    (first === 0x3fff && (second & 0xf000) === 0) ||
    first === 0x5f00
  );
}

export function isPublicNetworkAddress(address: string) {
  const family = isIP(address);
  return family === 4 ? isPublicIpv4(address) : family === 6 ? isPublicIpv6(address) : false;
}

async function resolveWithTimeout(resolver: WebsiteAddressResolver, hostname: string) {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      resolver(hostname),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new UnsafeOfficialWebsiteError("Website DNS verification timed out.")),
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

export async function validateOfficialWebsite(
  value: string,
  resolver: WebsiteAddressResolver = defaultResolver,
) {
  let website: URL;
  try {
    website = new URL(value);
  } catch {
    throw new UnsafeOfficialWebsiteError("Enter a complete official website URL.");
  }

  if (website.protocol !== "https:" && website.protocol !== "http:") {
    throw new UnsafeOfficialWebsiteError("Only HTTP and HTTPS websites are allowed.");
  }
  if (website.username || website.password) {
    throw new UnsafeOfficialWebsiteError("Website credentials are not allowed.");
  }
  if (website.port) {
    throw new UnsafeOfficialWebsiteError("Non-standard website ports are not allowed.");
  }

  const hostname = website.hostname.replace(/^\[|\]$/g, "").toLocaleLowerCase("en");
  if (isIP(hostname) !== 0 || isBlockedHostname(hostname)) {
    throw new UnsafeOfficialWebsiteError();
  }

  try {
    for (let pass = 0; pass < DNS_VERIFICATION_PASSES; pass += 1) {
      const addresses = await resolveWithTimeout(resolver, hostname);
      if (
        addresses.length === 0 ||
        addresses.length > 32 ||
        addresses.some(({ address }) => !isPublicNetworkAddress(address))
      ) {
        throw new UnsafeOfficialWebsiteError();
      }
    }
  } catch (error) {
    if (error instanceof UnsafeOfficialWebsiteError) {
      throw error;
    }
    throw new UnsafeOfficialWebsiteError("The website hostname could not be verified.");
  }

  website.hash = "";
  return website.toString();
}
