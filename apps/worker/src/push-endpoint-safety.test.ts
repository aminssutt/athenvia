import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertSafePushEndpoint,
  PushEndpointResolutionError,
  UnsafePushEndpointError,
} from "./push-endpoint-safety";

const endpoint = "https://push.example.test/subscriptions/browser-1";
const publicResolver = async () => ["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"];

describe("Web Push endpoint SSRF guard", () => {
  it("accepts an HTTPS endpoint resolving only to public addresses", async () => {
    await assert.doesNotReject(assertSafePushEndpoint(endpoint, publicResolver));
  });

  it("rejects unsafe endpoint forms before resolving", async () => {
    for (const unsafeEndpoint of [
      "not a url",
      "http://push.example.test/subscription",
      "https://user:password@push.example.test/subscription",
      "https://pushgateway/subscription",
      "https://127.0.0.1/subscription",
      "https://[::1]/subscription",
    ]) {
      let resolved = false;
      await assert.rejects(
        assertSafePushEndpoint(unsafeEndpoint, async () => {
          resolved = true;
          return ["93.184.216.34"];
        }),
        UnsafePushEndpointError,
      );
      assert.equal(resolved, false);
    }
  });

  it("rejects endpoints resolving to private, loopback, or link-local addresses", async () => {
    for (const address of [
      "10.0.0.7",
      "127.0.0.1",
      "169.254.169.254",
      "172.16.0.1",
      "192.168.1.1",
      "::1",
      "fc00::1",
      "::ffff:10.0.0.7",
    ]) {
      await assert.rejects(
        assertSafePushEndpoint(endpoint, async () => [address]),
        UnsafePushEndpointError,
      );
    }
  });

  it("rejects when a single resolved address is private among public ones", async () => {
    await assert.rejects(
      assertSafePushEndpoint(endpoint, async () => ["93.184.216.34", "169.254.169.254"]),
      UnsafePushEndpointError,
    );
  });

  it("rejects an empty resolution as unsafe", async () => {
    await assert.rejects(
      assertSafePushEndpoint(endpoint, async () => []),
      UnsafePushEndpointError,
    );
  });

  it("reports resolver failures as retryable resolution errors", async () => {
    await assert.rejects(
      assertSafePushEndpoint(endpoint, async () => {
        throw new Error("ENOTFOUND push.example.test");
      }),
      PushEndpointResolutionError,
    );
  });
});
