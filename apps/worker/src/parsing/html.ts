import { SafeTextExtractionError } from "./errors";
import type { SafeTextLimits } from "./limits";
import { TextCollector } from "./text-collector";

const BLOCK_TAGS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "dd",
  "details",
  "dialog",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "tbody",
  "tfoot",
  "thead",
  "tr",
  "ul",
]);
const HIDDEN_CONTENT_TAGS = new Set([
  "canvas",
  "embed",
  "iframe",
  "math",
  "noscript",
  "object",
  "script",
  "style",
  "svg",
  "template",
]);
const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);
const NAMED_ENTITIES: Readonly<Record<string, string>> = Object.freeze({
  amp: "&",
  apos: "'",
  copy: "©",
  euro: "€",
  gt: ">",
  hellip: "…",
  laquo: "«",
  ldquo: "“",
  lsquo: "‘",
  lt: "<",
  mdash: "—",
  middot: "·",
  ndash: "–",
  nbsp: "\u00a0",
  quot: '"',
  raquo: "»",
  rdquo: "”",
  reg: "®",
  rsquo: "’",
  trade: "™",
});

type HtmlFrame = {
  hidden: boolean;
  name: string;
};

export type HtmlExtractionStats = {
  tagsVisited: number;
};

function decodeHtmlEntities(value: string): string {
  return value.replace(
    /&(#(?:x[0-9a-f]{1,6}|[0-9]{1,7})|[a-z][a-z0-9]{1,31});/giu,
    (entity, body: string) => {
      if (body.startsWith("#")) {
        const hexadecimal = body[1]?.toLowerCase() === "x";
        const digits = body.slice(hexadecimal ? 2 : 1);
        const codePoint = Number.parseInt(digits, hexadecimal ? 16 : 10);

        if (
          !Number.isInteger(codePoint) ||
          codePoint <= 0 ||
          codePoint > 0x10ffff ||
          (codePoint >= 0xd800 && codePoint <= 0xdfff)
        ) {
          return "\uFFFD";
        }

        return String.fromCodePoint(codePoint);
      }

      return NAMED_ENTITIES[body.toLowerCase()] ?? entity;
    },
  );
}

function decodeHtmlBuffer(body: Buffer): string {
  if (body.length >= 2 && body[0] === 0xff && body[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(body.subarray(2));
  }

  if (body.length >= 2 && body[0] === 0xfe && body[1] === 0xff) {
    const swapped = Buffer.allocUnsafe(body.length - 2);
    for (let index = 2; index + 1 < body.length; index += 2) {
      swapped[index - 2] = body[index + 1] ?? 0;
      swapped[index - 1] = body[index] ?? 0;
    }
    return new TextDecoder("utf-16le").decode(swapped);
  }

  const prefix = body.subarray(0, Math.min(body.length, 2_048)).toString("latin1");
  const declaredCharset =
    /<meta\b[^>]*\bcharset\s*=\s*["']?\s*([a-z0-9._-]+)/iu.exec(prefix)?.[1] ??
    /<meta\b[^>]*\bcontent\s*=\s*["'][^"']*charset\s*=\s*([a-z0-9._-]+)/iu.exec(prefix)?.[1];
  const normalizedCharset = declaredCharset?.toLowerCase();

  if (
    normalizedCharset === "windows-1252" ||
    normalizedCharset === "iso-8859-1" ||
    normalizedCharset === "latin1"
  ) {
    return new TextDecoder("windows-1252").decode(body);
  }

  return new TextDecoder("utf-8").decode(
    body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf ? body.subarray(3) : body,
  );
}

function hasHiddenAttribute(tagSource: string): boolean {
  return (
    /(?:^|\s)hidden(?:\s|=|\/|$)/iu.test(tagSource) ||
    /\baria-hidden\s*=\s*(?:"true"|'true'|true)(?:\s|\/|$)/iu.test(tagSource) ||
    /\bstyle\s*=\s*(?:"[^"]*(?:display\s*:\s*none|visibility\s*:\s*hidden)[^"]*"|'[^']*(?:display\s*:\s*none|visibility\s*:\s*hidden)[^']*')/iu.test(
      tagSource,
    )
  );
}

function tagName(tagSource: string, closing: boolean): string | null {
  const offset = closing ? 2 : 1;
  return /^[a-z][a-z0-9:-]*/iu.exec(tagSource.slice(offset).trimStart())?.[0]?.toLowerCase() ?? null;
}

function closeFrame(stack: HtmlFrame[], name: string): number {
  const matchingIndex = stack.findLastIndex((frame) => frame.name === name);
  if (matchingIndex < 0) {
    return 0;
  }

  const removed = stack.splice(matchingIndex);
  return removed.reduce((count, frame) => count + Number(frame.hidden), 0);
}

export function extractHtmlText(
  body: Buffer,
  limits: SafeTextLimits,
): { stats: HtmlExtractionStats; text: string } {
  if (body.length > limits.maximumHtmlBytes) {
    throw new SafeTextExtractionError(
      "INPUT_TOO_LARGE",
      "HTML input exceeded the configured byte limit.",
      { inputBytes: body.length, maximumBytes: limits.maximumHtmlBytes },
    );
  }

  const html = decodeHtmlBuffer(body);
  const collector = new TextCollector(limits.maximumOutputCharacters);
  const stack: HtmlFrame[] = [];
  let cursor = 0;
  let hiddenDepth = 0;
  let tagsVisited = 0;

  while (cursor < html.length) {
    const opening = html.indexOf("<", cursor);

    if (opening < 0) {
      if (hiddenDepth === 0) {
        collector.text(decodeHtmlEntities(html.slice(cursor)));
      }
      break;
    }

    if (opening > cursor && hiddenDepth === 0) {
      collector.text(decodeHtmlEntities(html.slice(cursor, opening)));
    }

    if (html.startsWith("<!--", opening)) {
      const commentEnd = html.indexOf("-->", opening + 4);
      cursor = commentEnd < 0 ? html.length : commentEnd + 3;
      continue;
    }

    const tagEnd = html.indexOf(">", opening + 1);
    if (tagEnd < 0 || tagEnd - opening > 16_384) {
      if (hiddenDepth === 0) {
        collector.text("<");
      }
      cursor = opening + 1;
      continue;
    }

    const source = html.slice(opening, tagEnd + 1);
    const closing = /^<\s*\//u.test(source);
    const name = tagName(source, closing);
    cursor = tagEnd + 1;

    if (!name) {
      continue;
    }

    tagsVisited += 1;
    if (tagsVisited > limits.maximumHtmlTags) {
      throw new SafeTextExtractionError(
        "HTML_LIMIT_EXCEEDED",
        "HTML input exceeded the configured tag budget.",
        { maximumTags: limits.maximumHtmlTags },
      );
    }

    if (closing) {
      const wasVisible = hiddenDepth === 0;
      hiddenDepth -= closeFrame(stack, name);
      if (hiddenDepth < 0) {
        hiddenDepth = 0;
      }

      if ((wasVisible || hiddenDepth === 0) && BLOCK_TAGS.has(name)) {
        collector.line();
      }
      continue;
    }

    const locallyHidden = HIDDEN_CONTENT_TAGS.has(name) || hasHiddenAttribute(source);
    const visible = hiddenDepth === 0 && !locallyHidden;
    const selfClosing = /\/\s*>$/u.test(source) || VOID_TAGS.has(name);

    if (visible) {
      if (name === "br" || BLOCK_TAGS.has(name)) {
        collector.line();
      }
      if (name === "li") {
        collector.text("- ");
      } else if (name === "td" || name === "th") {
        collector.space();
      }
    }

    if (!selfClosing) {
      if (stack.length >= limits.maximumNestingDepth) {
        throw new SafeTextExtractionError(
          "HTML_LIMIT_EXCEEDED",
          "HTML input exceeded the configured nesting limit.",
          { maximumNestingDepth: limits.maximumNestingDepth },
        );
      }

      stack.push({ hidden: locallyHidden, name });
      if (locallyHidden) {
        hiddenDepth += 1;
      }
    }
  }

  return {
    stats: { tagsVisited },
    text: collector.finish(),
  };
}
