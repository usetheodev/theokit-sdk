/**
 * SE2 — typed runtime EVENT stream, ADDITIVE to the `SDKMessage` content stream.
 *
 * `Run.stream()` yields `SDKMessage`s (the conversation content). `RunEvent`s are
 * out-of-band runtime-OBSERVABILITY signals — the model's content is unaffected —
 * delivered opt-in via `SendOptions.onRunEvent`. Discriminate on `type`. Mirrors
 * the Anthropic `SDKMessage`-union approach (rate-limit, permission-denied, task
 * lifecycle, compaction boundary).
 *
 * The union is the forward-compatible CONTRACT (discriminate exhaustively). As of
 * SE2 the runtime EMITS `tool_progress` and `permission_denied` end-to-end (from
 * the agent-loop tool-dispatch seam). `rate_limit`, `task_*`, and `compact_boundary`
 * are part of the contract; their emission is wired incrementally as the sink is
 * threaded into the LLM-client retry / task / session-compaction subsystems (they
 * live below the loop). A consumer switching on `type` is future-proof either way.
 *
 * @public
 */
export type RunEvent =
  | RunToolProgressEvent
  | RunRateLimitEvent
  | RunPermissionDeniedEvent
  | RunTaskStartedEvent
  | RunTaskUpdatedEvent
  | RunTaskCompletedEvent
  | RunCompactBoundaryEvent
  | RunTripwireEvent;

/**
 * SE24 — a guardrail processor called `abort()`; the run stops with a tripwire.
 * Delivered via {@link SendOptions.onRunEvent} (mirrors the `RunResult.tripwire`
 * surfaced on `wait()`).
 */
export interface RunTripwireEvent {
  readonly type: "tripwire";
  readonly reason: string;
  readonly processorId: string;
}

/** A tool call is being dispatched (before its result). */
export interface RunToolProgressEvent {
  readonly type: "tool_progress";
  readonly toolName: string;
  readonly toolCallId: string;
}

/** The provider returned a rate-limit (HTTP 429); the loop will back off + retry. */
export interface RunRateLimitEvent {
  readonly type: "rate_limit";
  /** Retry attempt number (1-based) about to be delayed. */
  readonly attempt: number;
  /** Delay in ms before the retry, when the provider/policy supplied one. */
  readonly retryAfterMs?: number;
}

/**
 * A tool call was DENIED before dispatch — by the permission gate/plugin (SE1),
 * an operator file-hook `preToolUse`, or the fork tool-whitelist. `source`
 * discriminates which. `toolCallId` joins the event to the tool-call log.
 */
export interface RunPermissionDeniedEvent {
  readonly type: "permission_denied";
  readonly toolName: string;
  readonly toolCallId: string;
  /** Which layer blocked the call. */
  readonly source: "plugin" | "file_hook" | "fork_whitelist";
  /** The rejection message surfaced to the model. */
  readonly message: string;
}

/** A background task/subagent started. */
export interface RunTaskStartedEvent {
  readonly type: "task_started";
  readonly taskId: string;
  readonly description?: string;
}

/** A background task/subagent changed state. */
export interface RunTaskUpdatedEvent {
  readonly type: "task_updated";
  readonly taskId: string;
  readonly status: string;
}

/** A background task/subagent finished. */
export interface RunTaskCompletedEvent {
  readonly type: "task_completed";
  readonly taskId: string;
  readonly status: "completed" | "failed" | "stopped";
}

/** The conversation crossed a compaction boundary (history was summarized). */
export interface RunCompactBoundaryEvent {
  readonly type: "compact_boundary";
  readonly trigger: "manual" | "auto";
  /** Token count before compaction, when known. */
  readonly preTokens?: number;
}

/**
 * SE2 — the opt-in sink for {@link RunEvent}s. Supplied via `SendOptions.onRunEvent`.
 * Synchronous + best-effort: a throwing sink must never break the run (the emitter
 * try-catches it), so keep it fast (push to a queue, don't await).
 */
export type RunEventSink = (event: RunEvent) => void;

/**
 * SE2 — emit a {@link RunEvent} to an optional sink, swallowing any sink error so
 * observability can never break the run (fail-safe, mirrors the EventBus EC-2
 * contract). No-op when the sink is absent.
 */
export function emitRunEvent(sink: RunEventSink | undefined, event: RunEvent): void {
  if (sink === undefined) return;
  try {
    sink(event);
  } catch {
    // best-effort: an observability sink must never break the run.
  }
}
