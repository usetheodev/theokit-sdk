/**
 * OTel telemetry for the Task registry (ADR D371).
 *
 * Spans:
 *   - `task.submit` — short-lived span around the submit + insert.
 *   - `task.transition` — per state transition (attrs: from / to).
 *   - `task.cancel` — invoked from `Task.cancel` or via cancelRequested honor.
 *
 * Uses the existing tracer seam (D34); when OTel is absent, every helper
 * returns the shared no-op span. No new peer deps.
 *
 * @internal
 */

import { getTracer, noopSpan, type SpanLike } from "../observability/tracer-loader.js";

const TRACER_NAME = "@usetheo/sdk/task";

export function startTaskSubmitSpan(info: { taskId: string; kind: string }): SpanLike {
  const tracer = getTracer(TRACER_NAME);
  if (tracer === undefined) return noopSpan;
  return tracer.startSpan("task.submit", {
    attributes: {
      "task.id": info.taskId,
      "task.kind": info.kind,
    },
  });
}

export function startTaskTransitionSpan(info: {
  taskId: string;
  from: string;
  to: string;
}): SpanLike {
  const tracer = getTracer(TRACER_NAME);
  if (tracer === undefined) return noopSpan;
  return tracer.startSpan("task.transition", {
    attributes: {
      "task.id": info.taskId,
      "task.state.from": info.from,
      "task.state.to": info.to,
    },
  });
}

export function startTaskCancelSpan(info: {
  taskId: string;
  reason?: string;
  via: "api" | "cancelRequested";
}): SpanLike {
  const tracer = getTracer(TRACER_NAME);
  if (tracer === undefined) return noopSpan;
  return tracer.startSpan("task.cancel", {
    attributes: {
      "task.id": info.taskId,
      "task.cancel.via": info.via,
      ...(info.reason !== undefined ? { "task.cancel.reason": info.reason } : {}),
    },
  });
}
