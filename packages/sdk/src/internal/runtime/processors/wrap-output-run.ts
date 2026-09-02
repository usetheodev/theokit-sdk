/**
 * SE24 — wrap a {@link Run} so its `wait()` result passes through the output
 * processors before reaching the caller. A processor may redact/rewrite the
 * final text or `abort()` → the result becomes `cancelled` with a tripwire (and
 * a `tripwire` run-event is emitted). Streaming output redaction is deferred
 * (v1 processes the buffered `wait()` path only); a Proxy preserves every other
 * Run member (`stream`, `cancel`, `conversation`, …).
 *
 * @internal
 */

import type { Processor } from "../../../types/processors.js";
import type { Run, RunResult } from "../../../types/run.js";
import type { RunEventSink } from "../../../types/run-events.js";
import { emitRunEvent } from "../../emit-run-event.js";
import { runOutputProcessors } from "./run-processors.js";

export function wrapRunWithOutputProcessors(args: {
  run: Run;
  processors: readonly Processor[];
  agentId: string;
  onRunEvent: RunEventSink | undefined;
}): Run {
  if (args.processors.length === 0) return args.run;
  const compute = async (): Promise<RunResult> => {
    const result = await args.run.wait();
    // Only a finished run with text is worth processing; errors/cancels pass through.
    if (result.status !== "finished" || result.result === undefined) return result;
    const res = await runOutputProcessors(args.processors, result.result, args.agentId);
    if (res.kind === "ok") return { ...result, result: res.value };
    emitRunEvent(args.onRunEvent, {
      type: "tripwire",
      reason: res.tripwire.reason,
      processorId: res.tripwire.processorId,
    });
    // Suppress ONLY the model text (`result`); the run-level metadata survives on
    // purpose. An output block happens AFTER the model ran, so `usage`/`cost`/
    // `durationMs` are real and MUST reach the caller (billing honesty) — the
    // guardrail redacts the answer, it does not un-spend the tokens. `error` is
    // absent on a finished run, so no error/content field leaks through the spread.
    const { result: _suppressed, ...metadata } = result;
    return { ...metadata, status: "cancelled", tripwire: res.tripwire };
  };
  // Memoize so output processors run EXACTLY ONCE per run — `wait()` is idempotent
  // (the underlying run's wait() is too), so multiple wait() calls must not
  // re-redact or re-fire `onViolation`.
  let processed: Promise<RunResult> | undefined;
  const wrappedWait: Run["wait"] = () => {
    processed ??= compute();
    return processed;
  };
  return new Proxy(args.run, {
    get(target, prop, receiver) {
      if (prop === "wait") return wrappedWait;
      return Reflect.get(target, prop, receiver);
    },
  });
}
