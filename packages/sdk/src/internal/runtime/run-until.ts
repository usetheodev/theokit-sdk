/**
 * Goal-driven Ralph loop (T3.2, ADRs D115-D121).
 *
 * `runUntilImpl` is an `AsyncGenerator<GoalEvent, GoalResult, void>`:
 * yields events as the loop progresses, returns the final result when
 * the goal completes, fails, or is paused. The auxiliary judge model is
 * injected via `deps.judge` so the generator stays free of the `Agent`
 * façade import.
 *
 * EC-C fix: pre-aborted signals emit only `[paused]`, not `[active, paused]`.
 * EC-D: `maxTurns: 0` is supported (vacuous yield active → failed).
 *
 * @internal
 */

import type { SDKAgent } from "../../types/agent.js";
import type { GoalEvent, GoalOptions, GoalResult } from "../../types/goal-events.js";
import type { JudgeContext, JudgeOptions } from "../judge/judge-call.js";
import type { JudgeResult } from "../judge/types.js";

/** DI contract: the judge is the only external touchpoint. */
export interface RunUntilDeps {
  judge: (ctx: JudgeContext, opts?: JudgeOptions) => Promise<JudgeResult>;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: the goal-loop interleaves turn-start, send, judge, continuation, abort-check, and failure-bail — extracting helpers harms the linear narrative.
export async function* runUntilImpl(
  agent: SDKAgent,
  goal: string,
  options: GoalOptions | undefined,
  deps: RunUntilDeps,
): AsyncGenerator<GoalEvent, GoalResult, void> {
  const maxTurns = options?.maxTurns ?? 20;
  const maxFails = options?.maxConsecutiveJudgeFailures ?? 3;
  const signal = options?.signal;
  // Use a function (not direct property access) so TS does not narrow
  // `signal.aborted` to `false | undefined` after the initial check.
  // AbortSignal.aborted is a getter that can flip true between calls.
  // biome-ignore lint/complexity/useOptionalChain: optional-chain would re-narrow signal?.aborted to `false | undefined` after the first check, defeating the purpose of this helper.
  const isAborted = (): boolean => signal !== undefined && signal.aborted;
  let turn = 0;
  let consecutiveFailures = 0;
  let lastResponse = "";

  // EC-C: signal already aborted BEFORE first event → emit only [paused].
  if (isAborted()) {
    yield {
      type: "status_change",
      status: "paused",
      reason: "aborted via AbortSignal before first turn",
    };
    return { status: "paused", turnsUsed: 0, finalResponse: undefined };
  }

  yield { type: "status_change", status: "active", reason: "Goal started" };

  while (turn < maxTurns) {
    if (isAborted()) {
      yield { type: "status_change", status: "paused", reason: "aborted via AbortSignal" };
      return { status: "paused", turnsUsed: turn, finalResponse: lastResponse || undefined };
    }

    turn += 1;
    yield { type: "turn_start", turn, goal };

    const continuationPrompt = turn === 1 ? goal : composeContinuation(goal, lastResponse);

    const run = await agent.send(continuationPrompt);
    const result = await run.wait();
    lastResponse = result.result ?? "";
    yield { type: "agent_response", turn, content: lastResponse };

    const judgeOpts: JudgeOptions = {};
    if (options?.judgeModel !== undefined) judgeOpts.judgeModel = options.judgeModel;
    if (options?.judgeApiKey !== undefined) judgeOpts.apiKey = options.judgeApiKey;
    const judgeCtx: JudgeContext = { goal, lastResponse };
    if (options?.subgoals !== undefined) judgeCtx.subgoals = options.subgoals;
    const judgment = await deps.judge(judgeCtx, judgeOpts);
    yield {
      type: "judge_verdict",
      turn,
      verdict: judgment.verdict,
      reason: judgment.reason,
      parseFailed: judgment.parseFailed,
    };

    if (judgment.parseFailed) {
      consecutiveFailures += 1;
      if (consecutiveFailures >= maxFails) {
        yield {
          type: "status_change",
          status: "failed",
          reason: `judge model too unreliable (${consecutiveFailures} parse failures in a row)`,
        };
        return {
          status: "failed",
          turnsUsed: turn,
          finalResponse: lastResponse || undefined,
        };
      }
    } else {
      consecutiveFailures = 0;
    }

    if (judgment.verdict === "done") {
      yield { type: "status_change", status: "completed", reason: judgment.reason };
      return { status: "completed", turnsUsed: turn, finalResponse: lastResponse || undefined };
    }
    if (judgment.verdict === "skipped") {
      yield {
        type: "status_change",
        status: "completed",
        reason: `skipped: ${judgment.reason}`,
      };
      return { status: "completed", turnsUsed: turn, finalResponse: lastResponse || undefined };
    }

    yield { type: "continuation", turn, prompt: continuationPrompt };
  }

  yield {
    type: "status_change",
    status: "failed",
    reason: `max turns (${maxTurns}) exhausted`,
  };
  return { status: "failed", turnsUsed: turn, finalResponse: lastResponse || undefined };
}

/**
 * Build the continuation user message for turns 2+. Keeps last response
 * preview short so we don't bloat the prompt cache.
 *
 * @internal
 */
export function composeContinuation(goal: string, lastResponse: string): string {
  return `Continue working toward the goal: ${goal}\n\nYour last response was:\n${lastResponse.slice(0, 1000)}`;
}
