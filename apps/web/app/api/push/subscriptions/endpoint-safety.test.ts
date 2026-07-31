import { describe, expect, it, vi } from "vitest";

import { resolvesToPublicAddresses } from "./endpoint-safety";

const endpoint = "https://push.example.test/subscriptions/browser-1";

describe("resolvesToPublicAddresses", () => {
  it("accepts an endpoint that resolves only to public addresses", async () => {
    const resolver = vi.fn(async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
    ]);

    await expect(resolvesToPublicAddresses(endpoint, resolver)).resolves.toBe(true);
    expect(resolver).toHaveBeenCalledWith("push.example.test");
  });

  it.each([
    "10.0.0.7",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "::1",
    "fc00::1",
    "::ffff:10.0.0.7",
  ])("rejects an endpoint resolving to the non-public address %s", async (address) => {
    const resolver = vi.fn(async () => [{ address, family: address.includes(":") ? 6 : 4 }]);

    await expect(resolvesToPublicAddresses(endpoint, resolver)).resolves.toBe(false);
  });

  it("rejects when any resolved address is private alongside public ones", async () => {
    const resolver = vi.fn(async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.7", family: 4 },
    ]);

    await expect(resolvesToPublicAddresses(endpoint, resolver)).resolves.toBe(false);
  });

  it("rejects endpoints whose hostname does not resolve", async () => {
    const resolver = vi.fn(async () => {
      throw new Error("ENOTFOUND");
    });

    await expect(resolvesToPublicAddresses(endpoint, resolver)).resolves.toBe(false);
  });

  it("rejects an empty resolution result", async () => {
    const resolver = vi.fn(async () => []);

    await expect(resolvesToPublicAddresses(endpoint, resolver)).resolves.toBe(false);
  });

  it("rejects unparseable endpoints without calling the resolver", async () => {
    const resolver = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]);

    await expect(resolvesToPublicAddresses("not a url", resolver)).resolves.toBe(false);
    expect(resolver).not.toHaveBeenCalled();
  });
});
