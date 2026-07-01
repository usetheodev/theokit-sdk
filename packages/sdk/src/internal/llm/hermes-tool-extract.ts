/**
 * Hermes tool-call extraction — leaked-dialect safe-parse (theokit#58 follow-up).
 *
 * Some models (qwen3-coder via OpenRouter, OpenAI-compatible API) intermittently emit their
 * Hermes tool-call dialect as assistant TEXT content instead of native `tool_calls`:
 *
 *   <function=NAME><parameter=KEY>VALUE</parameter>...</function></tool_call>
 *
 * When that happens the provider sends ZERO native tool_calls, so the agent loop sees an
 * `end_turn` with no tools and the intended call is silently lost. This pure helper recovers
 * those calls from the content so the loop can execute them.
 *
 * OPT-IN only (`ProviderProfile.extractToolCallsFromContent`) and run ONLY when the provider
 * emitted no native tool_calls. A code assistant can legitimately print a literal `<function=` in a
 * fenced code block, so recovery is gated TWICE: the per-route flag is the coarse enable, and the R5
 * request-scoped `allowedToolNames` allowlist below is the precise false-positive guard — a block is
 * promoted only when its name is a real tool in the current request. The size-guard (no native call)
 * prevents double-counting a real native call.
 *
 * Fail-open like `stripThinkBlocks`: a partial/unclosed block (missing the `</tool_call>`
 * marker) is NOT matched — it stays in the residual text and yields no tool call, so a corrupted
 * stream never fabricates a call from junk.
 *
 * Accepted best-effort limit (mirrors the consumer-side stripper EC-5): if a parameter VALUE
 * contains the literal substring `</tool_call>`, the non-greedy block scanner closes at that inner
 * occurrence. This errs toward NOT over-consuming text — same class as `strip-think`'s EC-10.
 *
 * Recovered parameter values are ALWAYS strings: the text dialect carries no per-param type info, so
 * `<parameter=count>5</parameter>` yields `{ count: "5" }`, not `{ count: 5 }`. A downstream schema
 * (e.g. Zod) coercing/validating the tool input is the right place to type it — a mismatch there
 * fails clear (typed tool error), never silently. This differs from the native `tool_calls` path,
 * whose `arguments` is JSON and is parsed into typed values.
 *
 * @internal
 */
import { sanitizeToolInput } from "../../sanitize/sanitize-tool-input.js";
import type { LlmToolCallPart } from "./types.js";

/** A full leaked block: `<function=NAME> …inner… </tool_call>`. The closing `</tool_call>` is
 *  required (fail-open: a partial block at stream end is left as text). Non-greedy inner. */
const HERMES_BLOCK = /<function=\s*([^>\s]+)\s*>([\s\S]*?)<\/tool_call>/g;
/** A single parameter inside a block: `<parameter=KEY>VALUE</parameter>`. Non-greedy value. */
const HERMES_PARAM = /<parameter=\s*([^>\s]+)\s*>([\s\S]*?)<\/parameter>/g;

export interface HermesExtractResult {
  /** Recovered tool calls (empty when none matched). */
  toolCalls: LlmToolCallPart[];
  /** Content with every PROMOTED block removed + trimmed; gated-out and unmatched blocks stay visible. */
  residualText: string;
}

/**
 * Recover Hermes-dialect tool calls leaked into assistant text. `makeId` supplies a unique id per
 * recovered call (the provider gave none). Pure — no side effects.
 *
 * @param allowedToolNames R5 request-scoped gate — when provided, only a block whose name is in the
 *   set is promoted (exact, case-sensitive); an empty set promotes nothing; `undefined` recovers all
 *   (back-compat). Gated-out blocks stay as visible text (they are not tool calls).
 * @internal
 */
export function extractHermesToolCalls(
  content: string,
  makeId: () => string,
  allowedToolNames?: ReadonlySet<string>,
): HermesExtractResult {
  // R5 request-scoped gate: promote a block only when its name is a real tool in the current request
  // (exact, case-sensitive — peer-project payload.ts:190). `undefined` allowlist → recover-all (back-compat
  // for direct callers); an EMPTY set recovers nothing (a request with no tools has nothing legitimate
  // to recover). The name is already trimmed above, so the gate and the emitted call agree (EC-1).
  const isPromoted = (name: string): boolean =>
    name.length > 0 && (allowedToolNames === undefined || allowedToolNames.has(name));
  const toolCalls: LlmToolCallPart[] = [];
  for (const block of content.matchAll(HERMES_BLOCK)) {
    const name = (block[1] ?? "").trim();
    if (!isPromoted(name)) continue;
    toolCalls.push({
      type: "tool_use",
      id: makeId(),
      name,
      input: parseHermesParams(block[2] ?? ""),
    });
  }
  // EC-5: strip ONLY promoted blocks — a gated-out block (e.g. a `<function=example>` in a code fence
  // whose name is not a request tool) keeps its text visible instead of being silently deleted.
  const residualText =
    toolCalls.length === 0
      ? content
      : content
          .replace(HERMES_BLOCK, (full, rawName) =>
            isPromoted((rawName ?? "").trim()) ? "" : full,
          )
          .trim();
  return { toolCalls, residualText };
}

/** Parse the `<parameter=KEY>VALUE</parameter>` pairs inside a block's inner text into an input map.
 *
 * Value hygiene is DELEGATED to the public `sanitizeToolInput` primitive (`@theokit/sdk/sanitize`,
 * trim-only) so the internal recovery and the public sanitizer share ONE source of truth (DRY) — the
 * P0 bug (`\n`-wrapped paths → `not_found` → stalled multi-read loops) was born from an ad-hoc,
 * un-shared trim. Keys are trimmed here (the regex already excludes whitespace from the key capture);
 * values stay strings (the doc-comment invariant), trimmed by the shared primitive. */
function parseHermesParams(inner: string): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const param of inner.matchAll(HERMES_PARAM)) {
    const key = param[1];
    const value = param[2];
    if (key === undefined || value === undefined) continue;
    input[key.trim()] = value;
  }
  return sanitizeToolInput(input, { trim: true }).value;
}
