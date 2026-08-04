/**
 * SE24 — a terminal {@link Run} born from an input-processor `abort()`. It never
 * reached the model: `wait()` resolves to a `cancelled` {@link RunResult}
 * carrying the tripwire; `stream()` yields no content messages. The `tripwire`
 * run-event is emitted by the caller via `SendOptions.onRunEvent` before this
 * run is returned.
 *
 * @internal
 */

import type { ModelSelection } from "../../../types/agent.js";
import type { SDKMessage } from "../../../types/messages.js";
import type { ProcessorTripwire } from "../../../types/processors.js";
import type { Run, RunOperation, RunResult, RunTimelineEvent } from "../../../types/run.js";
import { registerRun } from "../registry/run-registry.js";

const SUPPORTED: ReadonlySet<RunOperation> = new Set<RunOperation>([
  "stream",
  "wait",
  "cancel",
  "conversation",
]);

/**
 * theokit#140 - the timeline counterpart. Empty for the same fact `emptyStream` is empty for: a
 * tripwire run never executed, so it produced no events of any kind.
 */
function emptyTimeline(): AsyncGenerator<RunTimelineEvent, void> {
  return emptyStream() as unknown as AsyncGenerator<RunTimelineEvent, void>;
}

/** An already-exhausted async iterator — a tripwire run streams no content. */
function emptyStream(): AsyncGenerator<SDKMessage, void> {
  return {
    next: () => Promise.resolve({ done: true, value: undefined }),
    return: () => Promise.resolve({ done: true, value: undefined }),
    throw: (err: unknown) => Promise.reject(err),
    [Symbol.asyncIterator]() {
      return this;
    },
  } as AsyncGenerator<SDKMessage, void>;
}

export function createTripwireRun(args: {
  agentId: string;
  tripwire: ProcessorTripwire;
  model: ModelSelection | undefined;
}): Run {
  const id = globalThis.crypto.randomUUID();
  const result: RunResult = {
    id,
    status: "cancelled",
    tripwire: args.tripwire,
    ...(args.model !== undefined ? { model: args.model } : {}),
  };
  const run: Run = {
    id,
    agentId: args.agentId,
    status: "cancelled",
    ...(args.model !== undefined ? { model: args.model } : {}),
    stream: () => emptyStream(),
    // theokit#140 - a tripwire run never executed, so its timeline is empty by construction, the
    // same reason `stream()` is. Both are empty for the same fact, not by coincidence.
    events: () => emptyTimeline(),
    wait: () => Promise.resolve(result),
    cancel: () => Promise.resolve(),
    conversation: () => Promise.resolve([]),
    supports: (op: RunOperation) => SUPPORTED.has(op),
    unsupportedReason: (op: RunOperation) =>
      SUPPORTED.has(op) ? undefined : `operation "${op}" is not available on a tripwire run`,
    onDidChangeStatus: () => () => {}, // already terminal — status never changes
  };
  registerRun(run);
  return run;
}
