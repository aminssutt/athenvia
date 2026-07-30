import { describe, expect, it, vi } from "vitest";

import {
  isPublicNetworkAddress,
  UnsafeOfficialWebsiteError,
  validateOfficialWebsite,
} from "./safe-url";

const publicResolver = vi.fn(async () => [
  { address: "93.184.216.34", family: 4 },
  { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
]);

describe("validateOfficialWebsite", () => {
  it("accepts a public HTTP(S) hostname after two DNS checks", async () => {
    publicResolver.mockClear();

    await expect(
      validateOfficialWebsite("https://www.example.edu/admissions#deadlines", publicResolver),
    ).resolves.toBe("https://www.example.edu/admissions");
    expect(publicResolver).toHaveBeenCalledTimes(2);
  });

  it.each([
    "file:///etc/passwd",
    "https://user:password@example.edu/",
    "https://example.edu:8443/",
    "https://localhost/",
    "https://admissions.internal/",
    "https://127.0.0.1/",
    "https://8.8.8.8/",
    "https://[::1]/",
  ])("rejects unsafe URL form %s", async (website) => {
    await expect(validateOfficialWebsite(website, publicResolver)).rejects.toBeInstanceOf(
      UnsafeOfficialWebsiteError,
    );
  });

  it.each([
    "0.0.0.0",
    "10.1.2.3",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "198.18.0.1",
    "224.0.0.1",
    "::1",
    "fc00::1",
    "fe80::1",
    "64:ff9b::a00:1",
    "100::1",
    "2001::1",
    "2001:db8::1",
    "2002:a00:1::",
    "3fff::1",
    "5f00::1",
    "::ffff:127.0.0.1",
  ])("recognizes %s as non-public", (address) => {
    expect(isPublicNetworkAddress(address)).toBe(false);
  });

  it.each(["8.8.8.8", "93.184.216.34", "2606:4700:4700::1111"])(
    "recognizes %s as public",
    (address) => {
      expect(isPublicNetworkAddress(address)).toBe(true);
    },
  );

  it("rejects mixed public/private DNS answers", async () => {
    const resolver = vi.fn(async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]);

    await expect(validateOfficialWebsite("https://example.edu/", resolver)).rejects.toBeInstanceOf(
      UnsafeOfficialWebsiteError,
    );
  });

  it("detects a private answer on the second DNS pass", async () => {
    const resolver = vi
      .fn()
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      .mockResolvedValueOnce([{ address: "169.254.169.254", family: 4 }]);

    await expect(validateOfficialWebsite("https://example.edu/", resolver)).rejects.toBeInstanceOf(
      UnsafeOfficialWebsiteError,
    );
  });

  it("fails closed when DNS resolution fails", async () => {
    const resolver = vi.fn(async () => {
      throw new Error("ENOTFOUND");
    });

    await expect(validateOfficialWebsite("https://example.edu/", resolver)).rejects.toBeInstanceOf(
      UnsafeOfficialWebsiteError,
    );
  });
});
