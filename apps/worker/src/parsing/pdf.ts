import { inflateSync } from "node:zlib";

import { SafeTextExtractionError } from "./errors";
import type { SafeTextLimits } from "./limits";
import { TextCollector } from "./text-collector";

type DecodedStream = {
  body: Buffer;
  dictionary: string;
};

type PdfArrayPart =
  | { kind: "number"; value: number }
  | { bytes: Buffer; kind: "string" };

type PdfToken =
  | { kind: "array"; value: PdfArrayPart[] }
  | { kind: "number"; value: number }
  | { bytes: Buffer; kind: "string" }
  | { kind: "word"; value: string };

export type PdfExtractionStats = {
  cmapEntries: number;
  objectsVisited: number;
  pageCount: number;
  streamsDecoded: number;
  streamsSkipped: number;
};

const PDF_WHITESPACE = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const PDF_DELIMITERS = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);

function isWhitespace(byte: number | undefined): boolean {
  return byte !== undefined && PDF_WHITESPACE.has(byte);
}

function isTokenBoundary(source: string, start: number, length: number): boolean {
  const before = start > 0 ? source.charCodeAt(start - 1) : 0x20;
  const after = source.charCodeAt(start + length);
  return (PDF_WHITESPACE.has(before) || PDF_DELIMITERS.has(before)) &&
    (Number.isNaN(after) || PDF_WHITESPACE.has(after) || PDF_DELIMITERS.has(after));
}

function countPdfObjects(source: string, maximumObjects: number): number {
  const objectPattern = /(?:^|[\r\n])\s*\d+\s+\d+\s+obj\b/gu;
  let count = 0;

  while (objectPattern.exec(source)) {
    count += 1;
    if (count > maximumObjects) {
      throw new SafeTextExtractionError(
        "PDF_LIMIT_EXCEEDED",
        "PDF exceeded the configured object budget.",
        { maximumObjects },
      );
    }
  }

  return count;
}

function findDictionaryStart(source: string, streamIndex: number): number {
  const lowerBound = Math.max(0, streamIndex - 65_536);
  let nestedDictionaries = 0;

  for (let index = streamIndex - 2; index >= lowerBound; index -= 1) {
    const pair = source.slice(index, index + 2);

    if (pair === ">>") {
      nestedDictionaries += 1;
      index -= 1;
    } else if (pair === "<<") {
      if (nestedDictionaries === 0) {
        return index;
      }
      nestedDictionaries -= 1;
      index -= 1;
    }
  }

  return -1;
}

function parseFilters(dictionary: string): string[] {
  const arrayMatch = /\/Filter\s*\[([^\]]{0,2_048})\]/u.exec(dictionary);
  if (arrayMatch) {
    return [...arrayMatch[1].matchAll(/\/([A-Za-z0-9]+)/gu)].map((match) => match[1]);
  }

  const singleMatch = /\/Filter\s*\/([A-Za-z0-9]+)/u.exec(dictionary);
  return singleMatch ? [singleMatch[1]] : [];
}

function decodeAsciiHex(input: Buffer, maximumBytes: number): Buffer {
  const hexadecimal: number[] = [];

  for (const byte of input) {
    if (byte === 0x3e) {
      break;
    }
    if (isWhitespace(byte)) {
      continue;
    }
    const character = String.fromCharCode(byte);
    if (!/[0-9a-f]/iu.test(character)) {
      throw new SafeTextExtractionError("INVALID_PDF", "PDF ASCIIHex stream is malformed.");
    }
    hexadecimal.push(byte);
    if (Math.ceil(hexadecimal.length / 2) > maximumBytes) {
      throw new SafeTextExtractionError(
        "PDF_LIMIT_EXCEEDED",
        "Decoded PDF stream exceeded its byte limit.",
        { maximumStreamBytes: maximumBytes },
      );
    }
  }

  if (hexadecimal.length % 2 === 1) {
    hexadecimal.push(0x30);
  }

  return Buffer.from(Buffer.from(hexadecimal).toString("ascii"), "hex");
}

function decodeAscii85(input: Buffer, maximumBytes: number): Buffer {
  const output: number[] = [];
  let group: number[] = [];

  function appendGroup(values: number[], bytesToWrite: number): void {
    let accumulator = 0;
    for (const value of values) {
      accumulator = accumulator * 85 + value;
    }

    const decoded = [
      (accumulator >>> 24) & 0xff,
      (accumulator >>> 16) & 0xff,
      (accumulator >>> 8) & 0xff,
      accumulator & 0xff,
    ];
    output.push(...decoded.slice(0, bytesToWrite));

    if (output.length > maximumBytes) {
      throw new SafeTextExtractionError(
        "PDF_LIMIT_EXCEEDED",
        "Decoded PDF stream exceeded its byte limit.",
        { maximumStreamBytes: maximumBytes },
      );
    }
  }

  for (let index = 0; index < input.length; index += 1) {
    const byte = input[index];
    if (isWhitespace(byte) || (byte === 0x3c && input[index + 1] === 0x7e)) {
      if (byte === 0x3c) {
        index += 1;
      }
      continue;
    }
    if (byte === 0x7e && input[index + 1] === 0x3e) {
      break;
    }
    if (byte === 0x7a && group.length === 0) {
      output.push(0, 0, 0, 0);
      if (output.length > maximumBytes) {
        throw new SafeTextExtractionError(
          "PDF_LIMIT_EXCEEDED",
          "Decoded PDF stream exceeded its byte limit.",
          { maximumStreamBytes: maximumBytes },
        );
      }
      continue;
    }
    if (byte === undefined || byte < 0x21 || byte > 0x75) {
      throw new SafeTextExtractionError("INVALID_PDF", "PDF ASCII85 stream is malformed.");
    }

    group.push(byte - 0x21);
    if (group.length === 5) {
      appendGroup(group, 4);
      group = [];
    }
  }

  if (group.length === 1) {
    throw new SafeTextExtractionError("INVALID_PDF", "PDF ASCII85 stream is malformed.");
  }
  if (group.length > 1) {
    const bytesToWrite = group.length - 1;
    while (group.length < 5) {
      group.push(84);
    }
    appendGroup(group, bytesToWrite);
  }

  return Buffer.from(output);
}

function decodeStream(
  stream: Buffer,
  dictionary: string,
  limits: SafeTextLimits,
): Buffer | null {
  let decoded = stream;

  for (const filter of parseFilters(dictionary)) {
    if (filter === "ASCIIHexDecode" || filter === "AHx") {
      decoded = decodeAsciiHex(decoded, limits.maximumPdfStreamBytes);
    } else if (filter === "ASCII85Decode" || filter === "A85") {
      decoded = decodeAscii85(decoded, limits.maximumPdfStreamBytes);
    } else if (filter === "FlateDecode" || filter === "Fl") {
      try {
        decoded = inflateSync(decoded, {
          maxOutputLength: limits.maximumPdfStreamBytes,
        });
      } catch (error) {
        const code =
          error && typeof error === "object" && "code" in error ? String(error.code) : "";
        if (code === "ERR_BUFFER_TOO_LARGE") {
          throw new SafeTextExtractionError(
            "PDF_LIMIT_EXCEEDED",
            "Inflated PDF stream exceeded its byte limit.",
            { maximumStreamBytes: limits.maximumPdfStreamBytes },
          );
        }
        throw new SafeTextExtractionError(
          "INVALID_PDF",
          "A compressed PDF stream could not be decoded.",
          {},
          { cause: error },
        );
      }
    } else {
      return null;
    }

    if (decoded.length > limits.maximumPdfStreamBytes) {
      throw new SafeTextExtractionError(
        "PDF_LIMIT_EXCEEDED",
        "Decoded PDF stream exceeded its byte limit.",
        { maximumStreamBytes: limits.maximumPdfStreamBytes },
      );
    }
  }

  return decoded;
}

function readStreams(
  body: Buffer,
  source: string,
  limits: SafeTextLimits,
): { decoded: DecodedStream[]; skipped: number } {
  const decoded: DecodedStream[] = [];
  let skipped = 0;
  let cursor = 0;
  let decodedBytes = 0;
  let streamsVisited = 0;

  while (cursor < source.length) {
    const keyword = source.indexOf("stream", cursor);
    if (keyword < 0) {
      break;
    }
    cursor = keyword + 6;

    if (!isTokenBoundary(source, keyword, 6)) {
      continue;
    }

    streamsVisited += 1;
    if (streamsVisited > limits.maximumPdfStreams) {
      throw new SafeTextExtractionError(
        "PDF_LIMIT_EXCEEDED",
        "PDF exceeded the configured stream budget.",
        { maximumStreams: limits.maximumPdfStreams },
      );
    }

    const dictionaryStart = findDictionaryStart(source, keyword);
    if (dictionaryStart < 0) {
      throw new SafeTextExtractionError("INVALID_PDF", "PDF stream dictionary is missing.");
    }
    const dictionary = source.slice(dictionaryStart, keyword);

    let streamStart = keyword + 6;
    if (source.startsWith("\r\n", streamStart)) {
      streamStart += 2;
    } else if (source[streamStart] === "\n" || source[streamStart] === "\r") {
      streamStart += 1;
    } else {
      throw new SafeTextExtractionError("INVALID_PDF", "PDF stream separator is malformed.");
    }

    const directLength = /\/Length\s+(\d+)\b/u.exec(dictionary)?.[1];
    let streamEnd: number;
    let endKeyword: number;

    if (directLength) {
      const length = Number.parseInt(directLength, 10);
      if (!Number.isSafeInteger(length) || length > limits.maximumPdfStreamBytes) {
        throw new SafeTextExtractionError(
          "PDF_LIMIT_EXCEEDED",
          "Compressed PDF stream exceeded its byte limit.",
          { maximumStreamBytes: limits.maximumPdfStreamBytes },
        );
      }
      streamEnd = streamStart + length;
      endKeyword = source.indexOf("endstream", streamEnd);
      if (streamEnd > body.length || endKeyword < 0 || endKeyword - streamEnd > 2) {
        throw new SafeTextExtractionError("INVALID_PDF", "PDF stream length is inconsistent.");
      }
    } else {
      endKeyword = source.indexOf("endstream", streamStart);
      if (endKeyword < 0) {
        throw new SafeTextExtractionError("INVALID_PDF", "PDF stream is not terminated.");
      }
      streamEnd = endKeyword;
      if (source[streamEnd - 1] === "\n") {
        streamEnd -= 1;
        if (source[streamEnd - 1] === "\r") {
          streamEnd -= 1;
        }
      } else if (source[streamEnd - 1] === "\r") {
        streamEnd -= 1;
      }
      if (streamEnd - streamStart > limits.maximumPdfStreamBytes) {
        throw new SafeTextExtractionError(
          "PDF_LIMIT_EXCEEDED",
          "Compressed PDF stream exceeded its byte limit.",
          { maximumStreamBytes: limits.maximumPdfStreamBytes },
        );
      }
    }

    cursor = endKeyword + 9;
    if (/\/Subtype\s*\/Image\b/u.test(dictionary)) {
      skipped += 1;
      continue;
    }

    const result = decodeStream(body.subarray(streamStart, streamEnd), dictionary, limits);
    if (!result) {
      skipped += 1;
      continue;
    }

    decodedBytes += result.length;
    if (decodedBytes > limits.maximumPdfDecodedBytes) {
      throw new SafeTextExtractionError(
        "PDF_LIMIT_EXCEEDED",
        "PDF exceeded the total decoded stream budget.",
        { maximumDecodedBytes: limits.maximumPdfDecodedBytes },
      );
    }

    decoded.push({ body: result, dictionary });
  }

  return { decoded, skipped };
}

function bufferFromHex(hexadecimal: string): Buffer {
  const normalized = hexadecimal.length % 2 === 0 ? hexadecimal : `${hexadecimal}0`;
  return Buffer.from(normalized, "hex");
}

function decodeUtf16BigEndian(bytes: Buffer): string {
  if (bytes.length % 2 !== 0) {
    return new TextDecoder("windows-1252").decode(bytes);
  }

  const swapped = Buffer.allocUnsafe(bytes.length);
  for (let index = 0; index < bytes.length; index += 2) {
    swapped[index] = bytes[index + 1] ?? 0;
    swapped[index + 1] = bytes[index] ?? 0;
  }
  return new TextDecoder("utf-16le").decode(swapped);
}

function incrementBigEndian(bytes: Buffer, increment: number): Buffer {
  const result = Buffer.from(bytes);
  let carry = increment;

  for (let index = result.length - 1; index >= 0 && carry > 0; index -= 1) {
    const next = (result[index] ?? 0) + carry;
    result[index] = next & 0xff;
    carry = Math.floor(next / 256);
  }

  return result;
}

function readCMaps(
  streams: readonly DecodedStream[],
  maximumEntries: number,
): Array<Map<string, string>> {
  const maps: Array<Map<string, string>> = [];
  let totalEntries = 0;

  function addEntry(map: Map<string, string>, source: string, destination: string): void {
    if (totalEntries >= maximumEntries) {
      throw new SafeTextExtractionError(
        "PDF_LIMIT_EXCEEDED",
        "PDF exceeded the configured character-map budget.",
        { maximumCMapEntries: maximumEntries },
      );
    }
    map.set(source.toUpperCase(), decodeUtf16BigEndian(bufferFromHex(destination)));
    totalEntries += 1;
  }

  for (const stream of streams) {
    const content = stream.body.toString("latin1");
    if (!content.includes("begincmap") && !content.includes("beginbf")) {
      continue;
    }

    const map = new Map<string, string>();
    for (const block of content.matchAll(/beginbfchar([\s\S]*?)endbfchar/gu)) {
      for (const pair of block[1].matchAll(
        /<([0-9a-f]+)>\s*<([0-9a-f]+)>/giu,
      )) {
        addEntry(map, pair[1], pair[2]);
      }
    }

    for (const block of content.matchAll(/beginbfrange([\s\S]*?)endbfrange/gu)) {
      for (const range of block[1].matchAll(
        /<([0-9a-f]+)>\s*<([0-9a-f]+)>\s*<([0-9a-f]+)>/giu,
      )) {
        const first = bufferFromHex(range[1]);
        const last = bufferFromHex(range[2]);
        const destination = bufferFromHex(range[3]);

        if (first.length !== last.length || first.length > 4) {
          continue;
        }

        const firstNumber = first.readUIntBE(0, first.length);
        const lastNumber = last.readUIntBE(0, last.length);
        const count = lastNumber - firstNumber + 1;
        if (count <= 0 || count > maximumEntries - totalEntries) {
          throw new SafeTextExtractionError(
            "PDF_LIMIT_EXCEEDED",
            "PDF character-map range exceeded its entry budget.",
            { maximumCMapEntries: maximumEntries },
          );
        }

        for (let offset = 0; offset < count; offset += 1) {
          addEntry(
            map,
            incrementBigEndian(first, offset).toString("hex"),
            incrementBigEndian(destination, offset).toString("hex"),
          );
        }
      }
    }

    if (map.size > 0) {
      maps.push(map);
    }
  }

  return maps;
}

function decodeWithCMap(bytes: Buffer, map: Map<string, string>): { coverage: number; text: string } {
  const lengths = [...new Set([...map.keys()].map((key) => key.length / 2))].sort(
    (left, right) => right - left,
  );
  const output: string[] = [];
  let coverage = 0;
  let cursor = 0;

  while (cursor < bytes.length) {
    let matched = false;
    for (const length of lengths) {
      if (cursor + length > bytes.length) {
        continue;
      }
      const key = bytes.subarray(cursor, cursor + length).toString("hex").toUpperCase();
      const value = map.get(key);
      if (value !== undefined) {
        output.push(value);
        coverage += length;
        cursor += length;
        matched = true;
        break;
      }
    }

    if (!matched) {
      output.push("\uFFFD");
      cursor += 1;
    }
  }

  return { coverage, text: output.join("") };
}

function decodePdfString(bytes: Buffer, maps: readonly Map<string, string>[]): string {
  let bestMapped: { coverage: number; text: string } | null = null;

  for (const map of maps) {
    const candidate = decodeWithCMap(bytes, map);
    if (!bestMapped || candidate.coverage > bestMapped.coverage) {
      bestMapped = candidate;
    }
  }

  if (bestMapped && bestMapped.coverage === bytes.length) {
    return bestMapped.text;
  }

  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return decodeUtf16BigEndian(bytes.subarray(2));
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  }

  const looksUtf16BigEndian =
    bytes.length >= 4 &&
    bytes.length % 2 === 0 &&
    bytes.filter((byte, index) => index % 2 === 0 && byte === 0).length >= bytes.length / 4;

  return looksUtf16BigEndian
    ? decodeUtf16BigEndian(bytes)
    : new TextDecoder("windows-1252").decode(bytes);
}

function readLiteralString(body: Buffer, start: number): { bytes: Buffer; next: number } {
  const output: number[] = [];
  let depth = 1;
  let cursor = start + 1;

  while (cursor < body.length && depth > 0) {
    const byte = body[cursor];
    cursor += 1;

    if (byte === 0x5c) {
      const escaped = body[cursor];
      cursor += 1;
      if (escaped === 0x0d) {
        if (body[cursor] === 0x0a) {
          cursor += 1;
        }
      } else if (escaped === 0x0a) {
        continue;
      } else if (escaped !== undefined && escaped >= 0x30 && escaped <= 0x37) {
        let octal = String.fromCharCode(escaped);
        for (let count = 0; count < 2; count += 1) {
          const next = body[cursor];
          if (next === undefined || next < 0x30 || next > 0x37) {
            break;
          }
          octal += String.fromCharCode(next);
          cursor += 1;
        }
        output.push(Number.parseInt(octal, 8) & 0xff);
      } else {
        const escapes: Record<number, number> = {
          0x62: 0x08,
          0x66: 0x0c,
          0x6e: 0x0a,
          0x72: 0x0d,
          0x74: 0x09,
        };
        if (escaped !== undefined) {
          output.push(escapes[escaped] ?? escaped);
        }
      }
    } else if (byte === 0x28) {
      depth += 1;
      output.push(byte);
    } else if (byte === 0x29) {
      depth -= 1;
      if (depth > 0) {
        output.push(byte);
      }
    } else if (byte !== undefined) {
      output.push(byte);
    }
  }

  if (depth !== 0) {
    throw new SafeTextExtractionError("INVALID_PDF", "PDF text string is not terminated.");
  }

  return { bytes: Buffer.from(output), next: cursor };
}

function readHexString(body: Buffer, start: number): { bytes: Buffer; next: number } {
  let cursor = start + 1;
  const digits: number[] = [];

  while (cursor < body.length && body[cursor] !== 0x3e) {
    const byte = body[cursor];
    cursor += 1;
    if (isWhitespace(byte)) {
      continue;
    }
    if (
      byte === undefined ||
      !(
        (byte >= 0x30 && byte <= 0x39) ||
        (byte >= 0x41 && byte <= 0x46) ||
        (byte >= 0x61 && byte <= 0x66)
      )
    ) {
      throw new SafeTextExtractionError("INVALID_PDF", "PDF hexadecimal string is malformed.");
    }
    digits.push(byte);
  }

  if (body[cursor] !== 0x3e) {
    throw new SafeTextExtractionError("INVALID_PDF", "PDF hexadecimal string is not terminated.");
  }
  cursor += 1;

  if (digits.length % 2 === 1) {
    digits.push(0x30);
  }
  return {
    bytes: Buffer.from(Buffer.from(digits).toString("ascii"), "hex"),
    next: cursor,
  };
}

function readPdfToken(body: Buffer, start: number): { next: number; token: PdfToken | null } {
  let cursor = start;
  while (cursor < body.length && isWhitespace(body[cursor])) {
    cursor += 1;
  }

  if (body[cursor] === 0x25) {
    while (cursor < body.length && body[cursor] !== 0x0a && body[cursor] !== 0x0d) {
      cursor += 1;
    }
    return { next: cursor, token: null };
  }

  if (body[cursor] === 0x28) {
    const result = readLiteralString(body, cursor);
    return { next: result.next, token: { bytes: result.bytes, kind: "string" } };
  }
  if (body[cursor] === 0x3c && body[cursor + 1] !== 0x3c) {
    const result = readHexString(body, cursor);
    return { next: result.next, token: { bytes: result.bytes, kind: "string" } };
  }
  if (body[cursor] === 0x5b) {
    const parts: PdfArrayPart[] = [];
    cursor += 1;
    while (cursor < body.length && body[cursor] !== 0x5d) {
      const result = readPdfToken(body, cursor);
      cursor = result.next;
      if (!result.token) {
        continue;
      }
      if (result.token.kind === "string" || result.token.kind === "number") {
        parts.push(result.token);
      }
    }
    if (body[cursor] !== 0x5d) {
      throw new SafeTextExtractionError("INVALID_PDF", "PDF text array is not terminated.");
    }
    return { next: cursor + 1, token: { kind: "array", value: parts } };
  }

  const tokenStart = cursor;
  while (
    cursor < body.length &&
    !isWhitespace(body[cursor]) &&
    !PDF_DELIMITERS.has(body[cursor] ?? 0)
  ) {
    cursor += 1;
  }

  if (cursor === tokenStart) {
    return {
      next: cursor + 1,
      token: { kind: "word", value: String.fromCharCode(body[cursor] ?? 0) },
    };
  }

  const value = body.subarray(tokenStart, cursor).toString("ascii");
  const number = Number(value);
  return {
    next: cursor,
    token: Number.isFinite(number)
      ? { kind: "number", value: number }
      : { kind: "word", value },
  };
}

function extractContentStreamText(
  stream: Buffer,
  maps: readonly Map<string, string>[],
  collector: TextCollector,
  budget: { operations: number },
  maximumOperations: number,
): boolean {
  const operands: PdfToken[] = [];
  let cursor = 0;
  let insideText = false;
  let foundText = false;

  while (cursor < stream.length) {
    budget.operations += 1;
    if (budget.operations > maximumOperations) {
      throw new SafeTextExtractionError(
        "PDF_LIMIT_EXCEEDED",
        "PDF exceeded the configured parsing operation budget.",
        { maximumOperations },
      );
    }

    const result = readPdfToken(stream, cursor);
    cursor = result.next;
    const token = result.token;
    if (!token) {
      continue;
    }

    if (token.kind !== "word") {
      if (operands.length < 64) {
        operands.push(token);
      }
      continue;
    }

    if (token.value === "BT") {
      insideText = true;
      operands.length = 0;
      continue;
    }
    if (token.value === "ET") {
      insideText = false;
      collector.line();
      operands.length = 0;
      continue;
    }
    if (!insideText) {
      operands.length = 0;
      continue;
    }

    const last = operands.at(-1);
    if (token.value === "Tj" && last?.kind === "string") {
      collector.text(decodePdfString(last.bytes, maps));
      foundText = true;
    } else if (token.value === "TJ" && last?.kind === "array") {
      for (const part of last.value) {
        if (part.kind === "string") {
          collector.text(decodePdfString(part.bytes, maps));
          foundText = true;
        } else if (part.value <= -120) {
          collector.space();
        }
      }
    } else if ((token.value === "'" || token.value === '"') && last?.kind === "string") {
      collector.line();
      collector.text(decodePdfString(last.bytes, maps));
      foundText = true;
    } else if (token.value === "Td" || token.value === "TD" || token.value === "T*") {
      collector.line();
    }

    operands.length = 0;
  }

  return foundText;
}

export function extractPdfText(
  body: Buffer,
  limits: SafeTextLimits,
): { stats: PdfExtractionStats; text: string; warnings: string[] } {
  if (body.length > limits.maximumPdfBytes) {
    throw new SafeTextExtractionError(
      "INPUT_TOO_LARGE",
      "PDF input exceeded the configured byte limit.",
      { inputBytes: body.length, maximumBytes: limits.maximumPdfBytes },
    );
  }

  const header = body.subarray(0, Math.min(body.length, 1_024)).toString("latin1");
  if (!header.includes("%PDF-")) {
    throw new SafeTextExtractionError("INVALID_PDF", "Input does not contain a PDF header.");
  }

  const source = body.toString("latin1");
  if (/\/Encrypt\b/u.test(source)) {
    throw new SafeTextExtractionError(
      "ENCRYPTED_PDF",
      "Encrypted PDFs are not eligible for text extraction.",
    );
  }

  const objectsVisited = countPdfObjects(source, limits.maximumPdfObjects);
  const { decoded, skipped } = readStreams(body, source, limits);
  const maps = readCMaps(decoded, limits.maximumPdfCMapEntries);
  const collector = new TextCollector(limits.maximumOutputCharacters);
  const budget = { operations: 0 };
  let contentStreams = 0;

  for (const stream of decoded) {
    if (extractContentStreamText(
      stream.body,
      maps,
      collector,
      budget,
      limits.maximumPdfOperations,
    )) {
      contentStreams += 1;
    }
  }

  const text = collector.finish();
  if (!text) {
    throw new SafeTextExtractionError(
      "UNSUPPORTED_PDF",
      "PDF contains no supported text layer.",
      { decodedStreams: decoded.length, skippedStreams: skipped },
    );
  }

  const pageCount = [...source.matchAll(/\/Type\s*\/Page\b/gu)].length;
  const cmapEntries = maps.reduce((count, map) => count + map.size, 0);

  return {
    stats: {
      cmapEntries,
      objectsVisited,
      pageCount,
      streamsDecoded: decoded.length,
      streamsSkipped: skipped,
    },
    text,
    warnings: [
      ...(skipped > 0 ? [`${skipped} unsupported or non-text PDF streams were skipped.`] : []),
      ...(contentStreams === 0 ? ["No content streams produced text."] : []),
    ],
  };
}

