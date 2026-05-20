/**
 * Judge call primitive (T2.2, ADRs D119-D121).
 *
 * Instantiates a short-lived auxiliary agent that evaluates whether a
 * goal is satisfied. The auxiliary judge runs with `tools: []` and a
 * cheap model (default `openai/gpt-4o-mini`) — see ADR D119. The judge
 * model needs only API access; we read `OPENROUTER_API_KEY` directly
 * from the environment (EC-A — single source of truth) and let the
 * caller override via {@link JudgeOptions.apiKey} for Anthropic or
 * direct-OpenAI environments.
 *
 * NOTE: judge aux agents created from inside a `forkAgent` context will
 * inherit the parent fork's whitelist via AsyncLocalStorage (EC-J).
 * `tools: []` keeps this benign today; future callers that add tools to
 * a judge should be aware.
 *
 * @internal
 */

import type { AgentOptions, SDKAgent } from "../../types/agent.js";
import { parseVerdict } from "./parse-verdict.js";
import type { JudgeResult } from "./types.js";

/** Inputs to the judge — pure data. */
export interface JudgeContext {
  goal: string;
  lastResponse: string;
  subgoals?: string[];
}

/** Caller-supplied tuning knobs for the judge call. */
export interface JudgeOptions {
  /** Judge model identifier. Default `"openai/gpt-4o-mini"` (ADR D119). */
  judgeModel?: string;
  /** Override env. Default `process.env.OPENROUTER_API_KEY` (EC-A). */
  apiKey?: string;
}

/** Dependencies injected so `judge-call.ts` stays free of `Agent` import. */
export interface JudgeDeps {
  create: (options: AgentOptions) => Promise<SDKAgent>;
}

/**
 * Run the judge auxiliary agent and parse the verdict. Always returns a
 * `JudgeResult` — failures are folded into `{ parseFailed: true,
 * verdict: "continue" }` so the loop can decide based on consecutive
 * failures (ADR D121).
 *
 * @internal
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: judge call must (1) check env or override, (2) catch errors as fail-safe, (3) ensure aux dispose runs once regardless of outcome — three concerns linearly arranged, harm clarity to extract.
export async function judgeCallImpl(
  ctx: JudgeContext,
  options: JudgeOptions | undefined,
  deps: JudgeDeps,
): Promise<JudgeResult> {
  const prompt = composeJudgePrompt(ctx);
  // EC-A: single env source — OpenRouter only. No multi-provider fallback.
  const apiKey = options?.apiKey ?? process.env.OPENROUTER_API_KEY;
  if (apiKey === undefined) {
    return {
      verdict: "continue",
      reason:
        "judge unavailable: OPENROUTER_API_KEY missing and no override passed via options.apiKey",
      parseFailed: true,
    };
  }

  const judgeModel = options?.judgeModel ?? "openai/gpt-4o-mini";
  let auxAgent: SDKAgent | undefined;
  try {
    auxAgent = await deps.create({
      apiKey,
      model: { id: judgeModel },
      tools: [],
      local: {},
      metadata: { forkOrigin: "judge" },
    } as AgentOptions);
    const run = await auxAgent.send(prompt);
    const result = await run.wait();
    return parseVerdict(result.result ?? "");
  } catch (err) {
    return {
      verdict: "continue",
      reason: `judge call failed: ${err instanceof Error ? err.message : String(err)}`,
      parseFailed: true,
    };
  } finally {
    if (auxAgent !== undefined) {
      try {
        await auxAgent.dispose();
      } catch {
        // dispose errors are non-fatal; judge result is already prepared
      }
    }
  }
}

/**
 * Build the strict-format prompt the judge expects.
 *
 * @internal
 */
export function composeJudgePrompt(ctx: JudgeContext): string {
  const subgoals =
    ctx.subgoals !== undefined && ctx.subgoals.length > 0 ? ctx.subgoals.join(", ") : "(none)";
  return `You are a goal judge. Determine if this goal is satisfied.

Goal: ${ctx.goal}
Subgoals: ${subgoals}
Last agent response: ${ctx.lastResponse}

Respond with EXACTLY one of:
- DONE: <reason>
- CONTINUE: <what's left>
- SKIPPED: <why not applicable>

Be strict. If unclear, prefer CONTINUE.`;
}
