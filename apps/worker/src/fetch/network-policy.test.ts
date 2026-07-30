import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { OfficialSourceFetchError } from "./errors";
import { isPublicAddress, OfficialDomainPolicy } from "./network-policy";

describe("official-source network policy", () => {
  it("accepts ordinary public IPv4 and IPv6 addresses", () => {
    assert.equal(isPublicAddress("1.1.1.1"), true);
    assert.equal(isPublicAddress("2606:4700:4700::1111"), true);
  });

  it("rejects private, loopback, link-local, mapped, multicast, and documentation targets", () => {
    for (const address of [
      "0.0.0.0",
      "10.0.0.1",
      "100.64.0.1",
      "127.0.0.1",
      "169.254.169.254",
      "172.16.0.1",
      "192.168.1.1",
      "198.18.0.1",
      "203.0.113.1",
      "224.0.0.1",
      "::1",
      "::ffff:127.0.0.1",
      "fc00::1",
      "fe80::1",
      "2001:db8::1",
    ]) {
      assert.equal(isPublicAddress(address), false, address);
    }
  });

  it("requires an exact approved host and standard HTTP(S) target", () => {
    const policy = new OfficialDomainPolicy(["www.example.edu"]);
    assert.equal(policy.parseTarget("https://www.example.edu/program").hostname, "www.example.edu");

    for (const target of [
      "https://example.edu/program",
      "https://www.example.edu.attacker.test/program",
      "https://127.0.0.1/program",
      "ftp://www.example.edu/program",
      "https://user:secret@www.example.edu/program",
      "https://www.example.edu:8443/program",
    ]) {
      assert.throws(() => policy.parseTarget(target), OfficialSourceFetchError);
    }
  });

  it("fails closed when any DNS answer is private", async () => {
    const policy = new OfficialDomainPolicy(["www.example.edu"]);
    await assert.rejects(
      policy.resolvePublicTarget(new URL("https://www.example.edu/program"), async () => [
        "1.1.1.1",
        "127.0.0.1",
      ]),
      (error: unknown) =>
        error instanceof OfficialSourceFetchError && error.code === "PRIVATE_TARGET",
    );
  });
});
