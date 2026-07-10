/**
 * SE24 — the guardrail processor runner. Runs an ordered processor pipeline over
 * a string payload (the user message for input, the model's text for output).
 * Each processor may rewrite the payload (return a string), `abort()` (→ a
 * tripwire that short-circuits the rest), or `warn()` (fire `onViolation`,
 * continue). A processor's own bug (a non-abort throw) propagates (fail-fast).
 *
 * @internal
 */

import type {
  Processor,
  ProcessorTripwire,
  ProcessorViolation,
} from "../../../types/processors.js";

/** Sentinel thrown by `ctx.abort()`; caught by the runner to build a tripwire. */
class ProcessorAbort {
  constructor(
    readonly processorId: string,
    readonly reason: string,
  ) {}
}

/** Outcome of a processor pipeline: the transformed payload, or a tripwire. @internal */
export type ProcessorPipelineResult =
  | { kind: "ok"; value: string }
  | { kind: "tripwire"; tripwire: ProcessorTripwire };

/** Invoke a processor's `onViolation` safely — a throw here never breaks the pipeline. */
function fireViolation(processor: Processor, violation: ProcessorViolation): void {
  try {
    processor.onViolation?.(violation);
  } catch {
    // Swallowed by contract — a violation-callback bug must not break the run.
  }
}

/** Build the `abort` / `warn` controls bound to one processor. */
function controlsFor(processor: Processor): {
  abort(reason: string): never;
  warn(message: string, detail?: unknown): void;
} {
  return {
    abort(reason: string): never {
      throw new ProcessorAbort(processor.id, reason);
    },
    warn(message: string, detail?: unknown): void {
      fireViolation(processor, {
        processorId: processor.id,
        message,
        ...(detail !== undefined ? { detail } : {}),
      });
    },
  };
}

/** Per-processor step outcome: the (possibly rewritten) value, or a tripwire. */
type StepResult = { value: string } | { tripwire: ProcessorTripwire };

/** The phase handler + its discriminator, or `undefined` when the processor has none. */
type SelectedHandler =
  | { kind: "input"; fn: NonNullable<Processor["processInput"]> }
  | { kind: "output"; fn: NonNullable<Processor["processOutput"]> };

function selectHandler(
  processor: Processor,
  phase: "input" | "output",
): SelectedHandler | undefined {
  if (phase === "input") {
    return processor.processInput ? { kind: "input", fn: processor.processInput } : undefined;
  }
  return processor.processOutput ? { kind: "output", fn: processor.processOutput } : undefined;
}

/** Call the handler with a ctx of its exact phase type — no intersection/`any` cast. */
function invokeHandler(
  handler: SelectedHandler,
  value: string,
  agentId: string,
  controls: ReturnType<typeof controlsFor>,
) {
  return handler.kind === "input"
    ? handler.fn({ message: value, agentId, ...controls })
    : handler.fn({ text: value, agentId, ...controls });
}

async function runOneProcessor(
  processor: Processor,
  value: string,
  agentId: string,
  phase: "input" | "output",
): Promise<StepResult> {
  const handler = selectHandler(processor, phase);
  if (handler === undefined) return { value }; // no handler for this phase
  try {
    const out = await invokeHandler(handler, value, agentId, controlsFor(processor));
    // A processor may return void (JS) — preserve the prior value in that case.
    return { value: typeof out === "string" ? out : value };
  } catch (err) {
    if (!(err instanceof ProcessorAbort)) throw err; // a genuine bug propagates (Rule 8)
    fireViolation(processor, { processorId: err.processorId, message: err.reason });
    return { tripwire: { reason: err.reason, processorId: err.processorId } };
  }
}

async function runPipeline(
  processors: ReadonlyArray<Processor>,
  initial: string,
  agentId: string,
  phase: "input" | "output",
): Promise<ProcessorPipelineResult> {
  let value = initial;
  for (const processor of processors) {
    const step = await runOneProcessor(processor, value, agentId, phase);
    if ("tripwire" in step) return { kind: "tripwire", tripwire: step.tripwire };
    value = step.value;
  }
  return { kind: "ok", value };
}

/** SE24 — run the input processors over the user message. @internal */
export function runInputProcessors(
  processors: ReadonlyArray<Processor>,
  message: string,
  agentId: string,
): Promise<ProcessorPipelineResult> {
  return runPipeline(processors, message, agentId, "input");
}

/** SE24 — run the output processors over the model's final text. @internal */
export function runOutputProcessors(
  processors: ReadonlyArray<Processor>,
  text: string,
  agentId: string,
): Promise<ProcessorPipelineResult> {
  return runPipeline(processors, text, agentId, "output");
}
