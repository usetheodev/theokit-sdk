import { TheokitAgentError } from "../../errors.js";
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
import type { JudgeResult } from "../../types/goal-events.js";
import { parseVerdict } from "./parse-verdict.js";

/** Inputs to the judge — pure data. */
export interface JudgeContext {
  goal: string;
  lastResponse: string;
  subgoals?: string[];
}

/** Caller-supplied tuning knobs for the judge call. */
export interface JudgeOptions {
  /**
   * Judge model identifier. When absent, it DERIVES from {@link agentModel} — and only falls back to the literal
   * `"openai/gpt-4o-mini"` when neither is provided.
   *
   * M80 — the fixed default was provider-blind: it only resolves on OpenRouter. With an Anthropic key it gives
   * 404, with an OAuth bearer it gives 401, and in both the goal burned 3 whole turns before failing with
   * a misleading reason. The agent-builder already worked around this by deriving on its own; the knowledge
   * belongs here.
   */
  judgeModel?: string;
  /**
   * M80 — the DRIVEN agent's model. It is the basis of the derivation: a judge running on the same model as the
   * chat works wherever chat works.
   */
  agentModel?: string;
  /** Override env. Default `process.env.OPENROUTER_API_KEY` (EC-A). */
  apiKey?: string;
}

/**
 * M80 — the judge's credential or model does not work: 401/404.
 *
 * Fails FAST by design. `rules/error-handling.md` § 2 separates recoverable from unrecoverable, and a
 * nonexistent model does not start existing on retry — folding that into `{parseFailed: true}` made the loop
 * try three times and report "failed" on a consecutive-failure limit, hiding that the cause was the
 * credential. A slow, opaque failure traded for a fast, clear one.
 *
 * PARSE failures and network errors stay folded: they are recoverable, and the loop already decides on
 * in a row.
 */
export class JudgeCredentialError extends TheokitAgentError {
  override readonly name = "JudgeCredentialError";

  constructor(
    readonly httpStatus: number,
    readonly judgeModel: string,
    cause: unknown,
  ) {
    super(
      `judge unavailable: model "${judgeModel}" returned ${String(httpStatus)}. ` +
        "Pass `judgeModel`/`apiKey` that resolve for this provider, or omit `judgeModel` to derive " +
        "it from the agent being driven.",
      { code: "judge_credential", cause, isRetryable: false },
    );
  }
}

/** Extracts the HTTP status from a provider error, when it carries one. */
function httpStatusOf(err: unknown): number | undefined {
  const s =
    (err as { status?: unknown; statusCode?: unknown }).status ??
    (err as { statusCode?: unknown }).statusCode;
  if (typeof s === "number") return s;
  const m = /\b(401|403|404)\b/.exec(err instanceof Error ? err.message : String(err));
  return m?.[1] !== undefined ? Number(m[1]) : undefined;
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

  // M80 — precedence: explicit > driven agent's model > the historical literal. The literal only
  // survives as a last resort, so as not to break callers who never passed either.
  const judgeModel = options?.judgeModel ?? options?.agentModel ?? "openai/gpt-4o-mini";
  let auxAgent: SDKAgent | undefined;
  try {
    auxAgent = await deps.create({
      apiKey,
      model: { id: judgeModel },
      tools: [],
      local: {},
      // #581 — `tools: []` READS as "no tools" and is not: a `shell` tool is always registered on a
      // local agent, this line included. This judge is sandboxed (unlike the scorer's), so the
      // exposure is smaller — but it still held a capability it never asked for, and whose absence
      // the line above appears to declare. Withholding is what actually declares it.
      withheldBuiltinTools: ["shell"],
      metadata: { forkOrigin: "judge" },
    } as AgentOptions);
    const run = await auxAgent.send(prompt);
    const result = await run.wait();
    return parseVerdict(result.result ?? "");
  } catch (err) {
    // M80 — 401/403/404 are credential/model errors: unrecoverable, failing fast and typed. Everything
    // else (network, timeout, 5xx) stays folded, because it IS recoverable and the loop already decides on
    // in a row.
    const status = httpStatusOf(err);
    if (status === 401 || status === 403 || status === 404) {
      throw new JudgeCredentialError(status, judgeModel, err);
    }
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
