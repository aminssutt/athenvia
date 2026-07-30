import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { deflateSync } from "node:zlib";

import { extractSafeText, SafeTextExtractionError } from "./index";

const fixtureUrl = new URL("./fixtures/admissions.pdf", import.meta.url);

type TestStream = {
  body: Buffer;
  filter?: string;
};

function pdfWithStreams(streams: readonly TestStream[], extra = ""): Buffer {
  const objects = streams.map(
    ({ body, filter }, index) =>
      Buffer.concat([
        Buffer.from(
          `${index + 1} 0 obj\n<< /Length ${body.length}${filter ? ` /Filter /${filter}` : ""} >>\nstream\n`,
          "ascii",
        ),
        body,
        Buffer.from("\nendstream\nendobj\n", "ascii"),
      ]),
  );

  return Buffer.concat([
    Buffer.from("%PDF-1.4\n", "ascii"),
    ...objects,
    Buffer.from(`${extra}\ntrailer\n<<>>\n%%EOF\n`, "ascii"),
  ]);
}

test("extracts deterministic text from an official admissions PDF fixture", async () => {
  const fixture = await readFile(fixtureUrl);
  const first = extractSafeText({ body: fixture, contentType: "application/pdf" });
  const second = extractSafeText({ body: fixture, contentType: "application/pdf" });

  assert.deepEqual(first, second);
  assert.equal(first.format, "pdf");
  assert.equal(first.text, "Official Admissions 2027\nDeadline: 15 January 2027");
  assert.equal(first.stats.pageCount, 1);
  assert.equal(first.stats.streamsDecoded, 1);
});

test("supports bounded Flate streams and ToUnicode character maps", () => {
  const cmap = Buffer.from(
    "begincmap\n1 beginbfchar\n<01> <0041>\nendbfchar\nendcmap",
    "ascii",
  );
  const content = deflateSync(Buffer.from("BT\n<01> Tj\nET", "ascii"));
  const fixture = pdfWithStreams([
    { body: cmap },
    { body: content, filter: "FlateDecode" },
  ]);

  const result = extractSafeText({ body: fixture, contentType: "application/pdf" });

  assert.equal(result.text, "A");
  assert.equal(result.stats.cmapEntries, 1);
  assert.equal(result.stats.streamsDecoded, 2);
});

test("rejects decompression bombs before oversized output allocation", () => {
  const compressed = deflateSync(Buffer.alloc(32_000, 0x41));
  const fixture = pdfWithStreams([{ body: compressed, filter: "FlateDecode" }]);

  assert.throws(
    () =>
      extractSafeText(
        { body: fixture, contentType: "application/pdf" },
        { limits: { maximumPdfStreamBytes: 1_024 } },
      ),
    (error) =>
      error instanceof SafeTextExtractionError && error.code === "PDF_LIMIT_EXCEEDED",
  );
});

test("does not execute PDF actions and rejects encrypted or image-only inputs", () => {
  delete (globalThis as Record<string, unknown>).__unsafePdfActionRan;
  const activeDocument = pdfWithStreams(
    [{ body: Buffer.from("BT\n(Safe visible text) Tj\nET", "ascii") }],
    "/OpenAction << /S /JavaScript /JS (globalThis.__unsafePdfActionRan=true) >>",
  );

  assert.equal(
    extractSafeText({ body: activeDocument, contentType: "application/pdf" }).text,
    "Safe visible text",
  );
  assert.equal((globalThis as Record<string, unknown>).__unsafePdfActionRan, undefined);

  assert.throws(
    () =>
      extractSafeText({
        body: Buffer.from("%PDF-1.4\ntrailer\n<< /Encrypt 1 0 R >>\n%%EOF"),
        contentType: "application/pdf",
      }),
    (error) =>
      error instanceof SafeTextExtractionError && error.code === "ENCRYPTED_PDF",
  );

  const imageOnly = Buffer.concat([
    Buffer.from("%PDF-1.4\n1 0 obj\n<< /Subtype /Image /Length 4 >>\nstream\n"),
    Buffer.from([0, 1, 2, 3]),
    Buffer.from("\nendstream\nendobj\n%%EOF"),
  ]);
  assert.throws(
    () => extractSafeText({ body: imageOnly, contentType: "application/pdf" }),
    (error) =>
      error instanceof SafeTextExtractionError && error.code === "UNSUPPORTED_PDF",
  );
});

