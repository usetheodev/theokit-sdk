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
 * emitted no native tool_calls — a code assistant can legitimately print a literal `<function=`
 * in a fenced code block, so default-off contains the blast radius and the size-guard prevents
 * double-counting a real native call.
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
import type { LlmToolCallPart } from "./types.js";

/** A full leaked block: `<function=NAME> …inner… </tool_call>`. The closing `</tool_call>` is
 *  required (fail-open: a partial block at stream end is left as text). Non-greedy inner. */
const HERMES_BLOCK = /<function=\s*([^>\s]+)\s*>([\s\S]*?)<\/tool_call>/g;
/** A single parameter inside a block: `<parameter=KEY>VALUE</parameter>`. Non-greedy value. */
const HERMES_PARAM = /<parameter=\s*([^>\s]+)\s*>([\s\S]*?)<\/parameter>/g;

export interface HermesExtractResult {
  /** Recovered tool calls (empty when none matched). */
  toolCalls: LlmToolCallPart[];
  /** Content with every recovered block removed + trimmed; original content when nothing matched. */
  residualText: string;
}

/**
 * Recover Hermes-dialect tool calls leaked into assistant text. `makeId` supplies a unique id per
 * recovered call (the provider gave none). Pure — no side effects.
 *
 * @internal
 */
export function extractHermesToolCalls(content: string, makeId: () => string): HermesExtractResult {
  const toolCalls: LlmToolCallPart[] = [];
  for (const block of content.matchAll(HERMES_BLOCK)) {
    const name = (block[1] ?? "").trim();
    if (name.length === 0) continue;
    toolCalls.push({
      type: "tool_use",
      id: makeId(),
      name,
      input: parseHermesParams(block[2] ?? ""),
    });
  }
  const residualText = toolCalls.length === 0 ? content : content.replace(HERMES_BLOCK, "").trim();
  return { toolCalls, residualText };
}

/** Parse the `<parameter=KEY>VALUE</parameter>` pairs inside a block's inner text into an input map. */
function parseHermesParams(inner: string): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const param of inner.matchAll(HERMES_PARAM)) {
    const key = param[1];
    const value = param[2];
    if (key === undefined || value === undefined) continue;
    // Trim BOTH key and value. Leaked-dialect emitters (qwen3-coder) put the value on its own line,
    // so the captured VALUE carries the formatting newlines (`<parameter=path>\npackage.json\n</…>`).
    // Untrimmed, a path/pattern gets `"\npackage.json\n"` and read_file / glob_files / search_text
    // fail `not_found` (only shell_exec tolerates it), stalling a multi-read investigation loop.
    // Trim removes only leading/trailing whitespace — internal newlines of a legitimate multi-line
    // value survive. Mirrors agentfw `parseInvokeParameters` (`(m[2] ?? '').trim()`, xml-tool-calls.ts:179).
    input[key.trim()] = value.trim();
  }
  return input;
}
