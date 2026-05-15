import { UnsupportedRunOperationError } from "../../errors.js";
import type { ConversationTurn } from "../../types/conversation.js";
import type { SDKMessage } from "../../types/messages.js";
import type { Run, RunOperation, RunResult, RunStatus } from "../../types/run.js";
import { generateRunId } from "../ids.js";

function makeStubAsyncGenerator(
  next: () => Promise<IteratorResult<SDKMessage, void>>,
): AsyncGenerator<SDKMessage, void> {
  const iterator: AsyncGenerator<SDKMessage, void> = {
    next,
    return: () => Promise.resolve({ value: undefined, done: true }),
    throw: (cause) => Promise.reject(cause),
    [Symbol.asyncIterator]() {
      return this;
    },
    [Symbol.asyncDispose]: () => Promise.resolve(),
  };
  return iterator;
}

function emptyStream(): AsyncGenerator<SDKMessage, void> {
  return makeStubAsyncGenerator(() => Promise.resolve({ value: undefined, done: true }));
}

function unsupportedStream(): AsyncGenerator<SDKMessage, void> {
  return makeStubAsyncGenerator(() =>
    Promise.reject(
      new UnsupportedRunOperationError(
        "stream is not available on historical cloud runs",
        "stream",
      ),
    ),
  );
}

/**
 * Minimal Run skeleton used in fixture mode where the full local runtime
 * is not yet wired. Provides stable IDs and method shapes so contract tests
 * that only assert handle shape (e.g. `Cron.run()`) pass.
 *
 * Real runtime adapters replace this with a state-machine-backed Run.
 *
 * @internal
 */

interface StubRunOptions {
  agentId: string;
  status?: RunStatus;
  result?: string;
  finalResult?: RunResult;
}

export function createStubRun(options: StubRunOptions): Run {
  const id = generateRunId();
  const initialStatus = options.status ?? "running";
  const finalResult: RunResult = options.finalResult ?? {
    id,
    status: initialStatus === "running" ? "finished" : initialStatus,
    result: options.result,
    durationMs: 0,
  };
  const supportedOps = new Set<RunOperation>(["stream", "wait", "cancel", "conversation"]);

  const listeners = new Set<(status: RunStatus) => void>();
  const handle: Run = {
    id,
    agentId: options.agentId,
    status: initialStatus,
    ...(options.result !== undefined ? { result: options.result } : {}),
    stream: () => emptyStream(),
    wait: () => Promise.resolve(finalResult),
    cancel: () => Promise.resolve(),
    conversation: () => Promise.resolve<ConversationTurn[]>([]),
    supports: (op: RunOperation) => supportedOps.has(op),
    unsupportedReason: (op: RunOperation) =>
      supportedOps.has(op) ? undefined : `Operation ${op} is not supported`,
    onDidChangeStatus: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return handle;
}

/**
 * Run handle for historical cloud runs — every streaming-style operation
 * throws `UnsupportedRunOperationError` per the run-status-operations
 * contract. Used by `Agent.getRun({ runtime: "cloud" })`.
 *
 * @internal
 */
export function createHistoricalCloudRun(agentId: string, runId?: string): Run {
  const id = runId ?? generateRunId();
  const unsupported = new Set<RunOperation>(["stream", "cancel"]);
  const supported = new Set<RunOperation>(["wait", "conversation"]);
  const finalResult: RunResult = { id, status: "finished", durationMs: 0 };
  return {
    id,
    agentId,
    status: "finished",
    stream: () => unsupportedStream(),
    wait: () => Promise.resolve(finalResult),
    cancel: () => Promise.resolve(),
    conversation: () => Promise.resolve<ConversationTurn[]>([]),
    supports: (op: RunOperation) => supported.has(op),
    unsupportedReason: (op: RunOperation) =>
      unsupported.has(op) ? "Historical cloud run — operation not available" : undefined,
    onDidChangeStatus: () => () => undefined,
  };
}
