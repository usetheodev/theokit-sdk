import { isPlainObject, tryJson } from "../../sanitize/coerce.js";
import type { LlmFinish, LlmRequest, LlmStopReason, LlmToolCallPart } from "./types.js";

/**
 * Collapse the wider `LlmRequest.system` shape (undefined | string | block[])
 * into a single string. Providers that don't support per-block prompt caching
 * join blocks with a blank-line separator.
 *
 * Shared between Ollama native and OpenAI-compatible clients.
 *
 * @internal
 */
export function collapseSystemText(system: LlmRequest["system"]): string {
  if (system === undefined) return "";
  if (typeof system === "string") return system;
  return system.map((b) => b.text).join("\n\n");
}

/**
 * Decode a buffered JSON-arguments string into an object. Falls back to a
 * `{ raw }` envelope so we never crash on malformed provider output.
 *
 * @internal
 */
export function parseToolArguments(buffered: string | undefined): Record<string, unknown> {
  if (buffered === undefined || buffered.length === 0) return {};
  try {
    return JSON.parse(buffered) as Record<string, unknown>;
  } catch {
    // M2 #61 — attempt jsonrepair (reusing the sanitize coerce helper, Rule 9)
    // before giving up, so a slightly-malformed native tool call (trailing
    // comma, unquoted key — the Kimi/K2 class) parses instead of landing in
    // `{ raw }` and bouncing to the model as an invalid_request round-trip.
    const repaired = tryJson(buffered, true);
    if (isPlainObject(repaired)) return repaired;
    return { raw: buffered };
  }
}

/**
 * Map an OpenAI-compatible `finish_reason` to the provider-agnostic stop reason.
 * Shared by the OpenAI stream accumulator. Unknown reasons fall back to `end_turn`.
 *
 * @internal
 */
export function mapOpenAIFinish(reason: string): LlmStopReason {
  switch (reason) {
    case "tool_calls":
      return "tool_use";
    case "length":
      return "max_tokens";
    default:
      return "end_turn";
  }
}

/**
 * Build the provider-agnostic `LlmFinish` shape from accumulator state.
 * Shared between the Anthropic and OpenAI stream parsers so the two
 * implementations don't drift on token-usage fields.
 *
 * @internal
 */
export function makeLlmFinish(state: {
  stopReason: LlmStopReason;
  text: string;
  toolCalls: LlmToolCallPart[];
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
}): LlmFinish {
  const finish: LlmFinish = {
    stopReason: state.stopReason,
    text: state.text,
    toolCalls: state.toolCalls,
  };
  if (state.inputTokens !== undefined) finish.inputTokens = state.inputTokens;
  if (state.outputTokens !== undefined) finish.outputTokens = state.outputTokens;
  if (state.cacheReadTokens !== undefined) finish.cacheReadTokens = state.cacheReadTokens;
  if (state.cacheWriteTokens !== undefined) finish.cacheWriteTokens = state.cacheWriteTokens;
  if (state.reasoningTokens !== undefined) finish.reasoningTokens = state.reasoningTokens;
  return finish;
}
