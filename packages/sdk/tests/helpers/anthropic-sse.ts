/**
 * The Anthropic `/v1/messages` streaming wire format, written down once.
 *
 * Sixteen test files hand-build an Anthropic SSE stub: the same route guard, the same
 * `text/event-stream` header, the same `event: ${e}\ndata: ${d}\n\n` frame — declared ten times
 * under four names (`enc`, `encoder`, `send`, `e`) plus inline `res.write` uses — and the same
 * message_start / content_block_start / content_block_delta / message_delta / message_stop envelope
 * shapes. That is the SDK's knowledge of a THIRD-PARTY wire format, duplicated sixteen ways: when
 * Anthropic changes the format, sixteen files are wrong and the compiler says nothing, because every
 * one of them is a string.
 *
 * It is also knowledge with a trap in it, which `capture-request.ts` already had to record beside
 * its own `ANTHROPIC_MESSAGES_SSE` constant: the `message_delta` carrying a `stop_reason` is
 * REQUIRED — without it `anthropic.ts` throws `stream_truncated` and the drain hangs on a stub that
 * looks complete. Every copy has to rediscover that. {@link messageStop} bundles it so nobody does.
 *
 * The aim is that a test declares a SCRIPT — what the model emits — rather than a PROTOCOL, which is
 * what those files are actually about.
 */

/** One SSE frame. The shape every copy re-declared. */
export function sseFrame(event: string, data: string): string {
  return `event: ${event}\ndata: ${data}\n\n`;
}

/** Opens a message. Anthropic sends a populated object; no consumer in this repo reads it. */
export function messageStart(): string {
  return sseFrame("message_start", "{}");
}

/** Opens a text block at `index`. */
export function textBlockStart(index = 0): string {
  return sseFrame(
    "content_block_start",
    JSON.stringify({
      type: "content_block_start",
      index,
      content_block: { type: "text", text: "" },
    }),
  );
}

/** A chunk of text inside the block at `index`. */
export function textDelta(text: string, index = 0): string {
  return sseFrame(
    "content_block_delta",
    JSON.stringify({ type: "content_block_delta", index, delta: { type: "text_delta", text } }),
  );
}

/** Opens a tool-use block. `input` arrives through {@link toolInputDelta}, not here. */
export function toolBlockStart(id: string, name: string, index = 0): string {
  return sseFrame(
    "content_block_start",
    JSON.stringify({
      type: "content_block_start",
      index,
      content_block: { type: "tool_use", id, name, input: {} },
    }),
  );
}

/** A chunk of the tool's JSON arguments, as Anthropic streams them: partial JSON text. */
export function toolInputDelta(partialJson: string, index = 0): string {
  return sseFrame(
    "content_block_delta",
    JSON.stringify({
      type: "content_block_delta",
      index,
      delta: { type: "input_json_delta", partial_json: partialJson },
    }),
  );
}

/** Closes the block at `index`. */
export function blockStop(index = 0): string {
  return sseFrame("content_block_stop", JSON.stringify({ type: "content_block_stop", index }));
}

/**
 * The `message_delta` frame alone, with the caller's exact usage payload.
 *
 * Separate from {@link messageStop} because the eighteen call sites this replaced carry EIGHT
 * different usage objects, and two carry none — those numbers are test data that individual tests
 * assert on, not duplicated knowledge. What was duplicated is the envelope around them: the
 * `type` / `delta.stop_reason` shape, which is Anthropic's and would change eighteen files at once.
 *
 * `usage` is omitted from the payload when not passed, rather than defaulted, so a site that sent no
 * usage still sends no usage.
 */
export function messageDelta(
  stopReason: string,
  // Partial on purpose: real payloads carry either field, and one call site sends output_tokens only.
  usage?: { input_tokens?: number; output_tokens?: number },
): string {
  return sseFrame(
    "message_delta",
    JSON.stringify({
      type: "message_delta",
      delta: { stop_reason: stopReason },
      ...(usage === undefined ? {} : { usage }),
    }),
  );
}

/**
 * Ends the message: the `message_delta` carrying `stop_reason` AND the `message_stop`.
 *
 * Both, together, on purpose. The `stop_reason` is what `anthropic.ts` waits for; a stub that emits
 * only `message_stop` produces a `stream_truncated` throw, and that is the failure every hand-built
 * copy has to discover for itself.
 */
export function messageStop(
  stopReason: "end_turn" | "tool_use" | "max_tokens" = "end_turn",
  usage: { input_tokens?: number; output_tokens?: number } = { input_tokens: 1, output_tokens: 1 },
): string {
  return (
    messageDelta(stopReason, usage) +
    sseFrame("message_stop", JSON.stringify({ type: "message_stop" }))
  );
}

/** A complete single-text-reply stream — the most common script in the suite. */
export function textReply(text: string): string {
  return messageStart() + textBlockStart() + textDelta(text) + blockStop() + messageStop();
}
