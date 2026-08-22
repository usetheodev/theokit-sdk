/**
 * W3C SSE parser (G8 internal) — `@theokit/sdk`.
 *
 * Per ADR D428. Reads from `ReadableStream<Uint8Array>` or async iterable of
 * UTF-8 chunks; yields parsed {@link SSEvent} objects per W3C SSE spec.
 *
 * Independent of `internal/llm/sse.ts:parseSseStream` (LLM-specific a peer vendor AI
 * Data Stream v1; locked by D38). This parser handles the `id:` field needed
 * for tracked envelopes (G8 resume mechanism), which the LLM parser ignores.
 *
 * Reference: https://html.spec.whatwg.org/multipage/server-sent-events.html
 *
 * @internal
 */

import type { SSEvent } from "./sse-encoder.js";

const decoder = new TextDecoder("utf-8");

/**
 * Parse an async iterable of UTF-8 byte chunks into a stream of SSE events.
 *
 * Implements the W3C event stream parser:
 * - Lines are split by `\n`, `\r\n`, or `\r`
 * - Events are dispatched on blank line (no `:` and no field name)
 * - Fields: `event`, `data` (multi-line concat with `\n`), `id`, `retry`
 * - Lines starting with `:` are comments (ignored, except dispatched as `comment`)
 * - Unknown fields silently ignored per spec
 *
 * Empty events (no fields) are NOT dispatched per spec.
 *
 * @internal
 */
export async function* parseSseW3C(
  source: AsyncIterable<Uint8Array>,
): AsyncGenerator<SSEvent, void, void> {
  let buffer = "";
  let eventName: string | undefined;
  let dataLines: string[] = [];
  let id: string | undefined;
  let retry: number | undefined;
  let commentLines: string[] = [];
  let hasField = false;

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: dispatch builds SSEvent from per-field state per W3C spec — refactor candidate
  const dispatch = (): SSEvent | null => {
    if (!hasField) {
      // Blank line with no preceding fields → reset state, no dispatch (per spec § 9.2.6)
      eventName = undefined;
      dataLines = [];
      id = undefined;
      retry = undefined;
      commentLines = [];
      return null;
    }
    const chunk: SSEvent = {};
    if (eventName !== undefined) (chunk as { event?: string }).event = eventName;
    if (dataLines.length > 0) (chunk as { data?: string }).data = dataLines.join("\n");
    if (id !== undefined) (chunk as { id?: string }).id = id;
    if (retry !== undefined) (chunk as { retry?: number }).retry = retry;
    if (commentLines.length > 0) (chunk as { comment?: string }).comment = commentLines.join("\n");
    eventName = undefined;
    dataLines = [];
    id = undefined;
    retry = undefined;
    commentLines = [];
    hasField = false;
    return chunk;
  };

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: handleLine dispatches across all SSE field kinds per W3C spec — refactor candidate
  const handleLine = (line: string): SSEvent | null => {
    if (line === "") {
      return dispatch();
    }
    if (line.startsWith(":")) {
      // Comment line — per spec ignored, but we surface it for keepalive visibility.
      commentLines.push(line.slice(1).replace(/^ /, ""));
      hasField = true;
      return null;
    }
    const colonIdx = line.indexOf(":");
    let field: string;
    let value: string;
    if (colonIdx === -1) {
      field = line;
      value = "";
    } else {
      field = line.slice(0, colonIdx);
      value = line.slice(colonIdx + 1);
      // Strip ONE leading space if present (per spec § 9.2.6)
      if (value.startsWith(" ")) value = value.slice(1);
    }
    switch (field) {
      case "event":
        eventName = value;
        hasField = true;
        break;
      case "data":
        dataLines.push(value);
        hasField = true;
        break;
      case "id":
        // Per spec: id with NULL is ignored
        if (!value.includes("\0")) {
          id = value;
          hasField = true;
        }
        break;
      case "retry":
        if (/^\d+$/.test(value)) {
          retry = Number.parseInt(value, 10);
          hasField = true;
        }
        break;
      default:
        // Unknown field — ignored per spec
        break;
    }
    return null;
  };

  for await (const bytes of source) {
    // Normalize CRLF / CR to LF then split
    buffer += decoder.decode(bytes, { stream: true }).replace(/\r\n|\r/g, "\n");
    let idx: number;
    // biome-ignore lint/suspicious/noAssignInExpressions: idiomatic while-assignment loop for buffered line parsing
    while ((idx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      const event = handleLine(line);
      if (event !== null) yield event;
    }
  }
  // Flush remaining buffer as a final line (no trailing newline case)
  buffer += decoder.decode();
  if (buffer.length > 0) {
    const event = handleLine(buffer);
    if (event !== null) yield event;
  }
  // Final dispatch in case last event lacked terminating blank line
  const tail = dispatch();
  if (tail !== null) yield tail;
}
