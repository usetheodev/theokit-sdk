/**
 * The fail-safe emitter for the `RunEvent` stream — runtime, deliberately NOT in `types/`.
 *
 * Eleven modules across `agent-loop/`, `runtime/`, `task/` and `local-agent/` call it; the type it
 * carries stays in `types/run-events.ts`, which is what `types/` is for. Sibling of
 * `internal/diagnostics.ts`, which swallows sink failures on the same principle and for the same
 * reason: observability degrades what you can SEE, never what the agent DOES.
 *
 * @internal
 */

import type { RunEvent, RunEventSink } from "../types/run-events.js";

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
