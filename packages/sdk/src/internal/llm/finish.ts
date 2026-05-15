import type { LlmFinish, LlmStopReason, LlmToolCallPart } from "./types.js";

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
    return { raw: buffered };
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
}): LlmFinish {
  const finish: LlmFinish = {
    stopReason: state.stopReason,
    text: state.text,
    toolCalls: state.toolCalls,
  };
  if (state.inputTokens !== undefined) finish.inputTokens = state.inputTokens;
  if (state.outputTokens !== undefined) finish.outputTokens = state.outputTokens;
  return finish;
}
