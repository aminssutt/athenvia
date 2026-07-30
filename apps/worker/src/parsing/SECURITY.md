# Safe text extraction

This module treats every fetched byte as hostile. It never creates a browser DOM, evaluates
JavaScript, follows links, resolves external PDF objects or launches a subprocess.

## Supported inputs

- HTML and XHTML are tokenized locally. Scriptable, embedded, styling, template, SVG and MathML
  subtrees are discarded. Hidden DOM subtrees are also omitted. Only decoded text is returned;
  attributes and URLs never enter the result.
- PDFs must have an unencrypted text layer. Plain, Flate, ASCIIHex and ASCII85 stream filters are
  supported. Text-showing operators (`Tj`, `TJ`, `'`, `"`) and common ToUnicode CMaps are decoded.
  Image-only/scanned or encrypted documents fail explicitly instead of invoking OCR or external
  tools.
- Plain text is normalized through the same bounded output collector.

## Determinism and resource limits

Results contain no timestamps, random values, network-derived state or platform-native utilities.
Whitespace, Unicode normalization and document traversal order are deterministic.

Default guards apply before or during allocation:

- 5 MiB HTML/plain input and 8 MiB PDF input
- 1,000,000 output characters
- bounded HTML tags and nesting
- bounded PDF objects, streams, decoded bytes, CMap entries and parser operations
- `zlib.inflateSync` uses `maxOutputLength`, preventing compressed streams from allocating beyond
  the per-stream budget
- image and unsupported streams are skipped without decoding

All limits can be lowered by the caller. Raising them should be reviewed as a memory/CPU change.

## Observable failures and retries

`SafeTextExtractionError` exposes a stable `code`, safe numeric/string `details` and `retryable`.
Deterministic input failures are non-retryable; unexpected infrastructure/parser failures use
`PARSING_FAILED` and are retryable. The optional `onEvent` callback receives content-free success
or failure events suitable for metrics/logging. Observer failures cannot change extraction.

Error messages and events never contain extracted text or source bytes.

