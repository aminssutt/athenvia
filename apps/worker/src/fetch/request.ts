import { request as requestHttp } from "node:http";
import { request as requestHttps } from "node:https";
import { isIP } from "node:net";

import { OfficialSourceFetchError } from "./errors";

export type RawResponse = {
  body: Buffer;
  headers: Readonly<Record<string, string | string[] | undefined>>;
  status: number;
};

export type PinnedRequest = (
  target: URL,
  address: string,
  options: { maximumBytes: number; timeoutMs: number; userAgent: string },
) => Promise<RawResponse>;

export const pinnedRequest: PinnedRequest = (target, address, options) =>
  new Promise((resolve, reject) => {
    const transport = target.protocol === "https:" ? requestHttps : requestHttp;
    const request = transport(
      target,
      {
        headers: {
          Accept: "text/html,application/xhtml+xml,application/pdf,text/plain;q=0.9,*/*;q=0.1",
          "User-Agent": options.userAgent,
        },
        lookup(_hostname, lookupOptions, callback) {
          const family = isIP(address);
          if (lookupOptions.all) {
            callback(null, [{ address, family }]);
          } else {
            callback(null, address, family);
          }
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;

        response.on("data", (chunk: Buffer | string) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += buffer.byteLength;
          if (size > options.maximumBytes) {
            request.destroy(
              new OfficialSourceFetchError(
                "RESPONSE_TOO_LARGE",
                "Official source exceeded the response-size limit.",
                { maximumBytes: options.maximumBytes },
              ),
            );
            return;
          }
          chunks.push(buffer);
        });
        response.on("end", () => {
          resolve({
            body: Buffer.concat(chunks),
            headers: response.headers,
            status: response.statusCode ?? 0,
          });
        });
      },
    );

    request.setTimeout(options.timeoutMs, () => {
      request.destroy(
        new OfficialSourceFetchError("TIMEOUT", "Official source request timed out.", {
          timeoutMs: options.timeoutMs,
        }),
      );
    });
    request.on("error", reject);
    request.end();
  });
