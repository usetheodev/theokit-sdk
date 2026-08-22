import { isPlainObject, tryJson } from "../../sanitize/coerce.js";
import { diag } from "../diagnostics.js";
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
/**
 * A provider-reported token count, or `undefined` when what arrived is not one.
 *
 * Accepts a non-negative finite number, and a numeric STRING — providers returning numeric JSON
 * fields as strings is not exotic, and untreated it produced `"0" + "100" + "050"` where a sum was
 * intended, feeding `"0100050"` to pricing (#372). Fractional values are floored: a count is a
 * count, and discarding one because a provider sent `12.7` would lose real usage.
 *
 * Rejects negatives, `NaN`, `Infinity` and anything non-numeric. A negative count is the dangerous
 * one: it moves a budget gate DOWNWARD, so the guard exists to protect spend accounting, not to
 * tidy types.
 *
 * MAGNITUDE IS DELIBERATELY NOT CHECKED. `9e15` tokens is absurd and yields an absurd cost, but any
 * ceiling here would be invented — it would reject a legitimate large batch while still passing
 * anything just under it. "How much is too much" is a budget policy, and `@theokit/sdk-budget` is
 * where a cap belongs and already lives.
 */
function asTokenCount(value: unknown): number | undefined {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return undefined;
  return Math.floor(n);
}

/** The `LlmFinish` fields that carry a token count — the ones {@link assign} may write. */
type TokenField =
  | "inputTokens"
  | "outputTokens"
  | "cacheReadTokens"
  | "cacheWriteTokens"
  | "reasoningTokens";

/** Set `key` on `finish` when `value` survives {@link asTokenCount}; report it on stderr when it does not. */
function assign(finish: LlmFinish, key: TokenField, value: unknown): void {
  if (value === undefined) return;
  const count = asTokenCount(value);
  if (count === undefined) {
    diag(
      `[theokit-sdk] provider reported an unusable ${key} (${String(value)}) — dropping it. ` +
        `Usage and cost for this turn will be incomplete.\n`,
    );
    return;
  }
  finish[key] = count;
}

export function makeLlmFinish(state: {
  stopReason: LlmStopReason;
  text: string;
  toolCalls: LlmToolCallPart[];
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  /** theokit#122 — the turn's thinking block, with its provider signature when one was issued. */
  thinking?: import("./types.js").LlmThinkingPart;
}): LlmFinish {
  const finish: LlmFinish = {
    stopReason: state.stopReason,
    text: state.text,
    toolCalls: state.toolCalls,
  };
  // #372 — validate at the boundary (`error-handling.md` § 2). Everything below arrives from a
  // provider's JSON and reaches `run.usage`, the cost calculation and `@theokit/sdk-budget` with no
  // check of its own further down.
  assign(finish, "inputTokens", state.inputTokens);
  assign(finish, "outputTokens", state.outputTokens);
  assign(finish, "cacheReadTokens", state.cacheReadTokens);
  assign(finish, "cacheWriteTokens", state.cacheWriteTokens);
  assign(finish, "reasoningTokens", state.reasoningTokens);
  if (state.thinking !== undefined) finish.thinking = state.thinking;
  return finish;
}
