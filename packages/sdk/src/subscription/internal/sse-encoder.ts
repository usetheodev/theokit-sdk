/**
 * W3C SSE encoder (G8 internal) — `@theokit/sdk`.
 *
 * Per ADR D428 (W3C wire format, independent of D38 a peer vendor AI Data Stream).
 *
 * Encodes a single SSE event into a UTF-8 byte buffer. Caller is responsible
 * for concatenating events + flushing to the underlying transport stream.
 *
 * Reference: https://html.spec.whatwg.org/multipage/server-sent-events.html
 *
 * @internal
 */

/**
 * One SSE event chunk. All fields optional; encoder omits absent ones.
 *
 * @internal
 */
export interface SSEvent {
  /** Event name (`event:` field). Defaults to `message` if omitted. */
  readonly event?: string;
  /** Payload (`data:` field). Multi-line strings emit one `data:` line each. */
  readonly data?: string;
  /** Last-Event-ID (`id:` field). Client echoes on reconnect. */
  readonly id?: string;
  /** Reconnect interval hint in ms (`retry:` field). */
  readonly retry?: number;
  /** SSE comment (`: ` field). Useful for keepalive/ping. */
  readonly comment?: string;
}

const encoder = new TextEncoder();

/**
 * Encode a single {@link SSEvent} to a UTF-8 byte buffer per W3C SSE spec.
 *
 * Events are terminated with a blank line (`\n\n`). The caller MUST NOT
 * concatenate events without that terminator — browsers (and the W3C parser
 * primitive in this package) split events on the blank line.
 *
 * @internal
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: SSE encoder branches across comment/event/data/retry/id fields per W3C spec — refactor candidate
export function encodeSseChunk(chunk: SSEvent): Uint8Array {
  const lines: string[] = [];

  if (chunk.comment !== undefined) {
    // Comments per spec are lines starting with `:`. Multiple lines = multiple comments.
    for (const line of chunk.comment.split("\n")) {
      lines.push(`: ${line}`);
    }
  }

  if (chunk.event !== undefined) {
    if (chunk.event.includes("\n")) {
      throw new TypeError("encodeSseChunk: event name must not contain newlines");
    }
    lines.push(`event: ${chunk.event}`);
  }

  if (chunk.id !== undefined) {
    if (chunk.id.includes("\n") || chunk.id.includes("\0")) {
      throw new TypeError("encodeSseChunk: id must not contain newlines or NULL");
    }
    lines.push(`id: ${chunk.id}`);
  }

  if (chunk.retry !== undefined) {
    if (!Number.isFinite(chunk.retry) || chunk.retry < 0 || !Number.isInteger(chunk.retry)) {
      throw new TypeError("encodeSseChunk: retry must be a non-negative integer (ms)");
    }
    lines.push(`retry: ${chunk.retry}`);
  }

  if (chunk.data !== undefined) {
    // Per spec, multi-line data is encoded as multiple `data:` lines.
    // The parser re-joins them with `\n`.
    for (const line of chunk.data.split("\n")) {
      lines.push(`data: ${line}`);
    }
  }

  // Terminate event with blank line. Empty events (no fields) still emit blank line.
  const payload = lines.length > 0 ? `${lines.join("\n")}\n\n` : "\n\n";
  return encoder.encode(payload);
}
