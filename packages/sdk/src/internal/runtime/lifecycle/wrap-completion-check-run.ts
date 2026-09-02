/**
 * SE34 — wrap a {@link Run} so a finished reply is scored by the shipped
 * LLM-as-judge against {@link SendOptions.completionCheck} (`isTaskComplete`).
 * The verdict is attached to `wait()`'s {@link RunResult.completionCheck} and a
 * `completion_check` run-event is emitted. This is the finer-grained, single-
 * `send()` completion gate (contrast `runUntil`, which judges BETWEEN sends).
 *
 * Non-invasive: only wraps when `completionCheck` is set, only judges a
 * `finished` run with text, memoizes so the judge runs EXACTLY ONCE, and a
 * Proxy preserves every other Run member. A fail-safe: a judge parse failure
 * yields `complete: false` (never silently "done"). The judge model is injected
 * via `deps.judge` so this module stays free of the Agent façade import.
 *
 * The judge fires from `wait()` (not from `stream()`); a stream-only consumer
 * must call `wait()` to trigger the verdict + the `completion_check` event.
 *
 * @internal
 */

import type { JudgeResult } from "../../../types/goal-events.js";
import type { CompletionCheck, Run, RunResult } from "../../../types/run.js";
import type { RunEventSink } from "../../../types/run-events.js";
import { emitRunEvent } from "../../emit-run-event.js";
import type { JudgeContext, JudgeOptions } from "../../judge/judge-call.js";

export interface CompletionCheckDeps {
  judge: (ctx: JudgeContext, opts?: JudgeOptions) => Promise<JudgeResult>;
}

export function wrapRunWithCompletionCheck(args: {
  run: Run;
  completionCheck: CompletionCheck | undefined;
  onRunEvent: RunEventSink | undefined;
  deps: CompletionCheckDeps;
}): Run {
  const check = args.completionCheck;
  if (check === undefined) return args.run;

  const compute = async (): Promise<RunResult> => {
    const result = await args.run.wait();
    // Only a finished run with text is judged; errors/cancels pass through untouched.
    if (result.status !== "finished" || result.result === undefined) return result;

    const judgeOpts: JudgeOptions = {};
    if (check.judgeModel !== undefined) judgeOpts.judgeModel = check.judgeModel;
    if (check.apiKey !== undefined) judgeOpts.apiKey = check.apiKey;
    const verdict = await args.deps.judge(
      { goal: check.criteria, lastResponse: result.result },
      judgeOpts,
    );
    // Fail-safe: a parse failure is NOT "complete". Judge "done" ⇒ complete.
    const complete = !verdict.parseFailed && verdict.verdict === "done";
    emitRunEvent(args.onRunEvent, {
      type: "completion_check",
      complete,
      reason: verdict.reason,
    });
    return {
      ...result,
      completionCheck: { complete, reason: verdict.reason, parseFailed: verdict.parseFailed },
    };
  };

  // Memoize — `wait()` is idempotent, so the judge must fire EXACTLY once.
  let judged: Promise<RunResult> | undefined;
  const wrappedWait: Run["wait"] = () => {
    judged ??= compute();
    return judged;
  };
  return new Proxy(args.run, {
    get(target, prop, receiver) {
      if (prop === "wait") return wrappedWait;
      return Reflect.get(target, prop, receiver);
    },
  });
}
