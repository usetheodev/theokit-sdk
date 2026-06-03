/**
 * OTel telemetry for workflows (ADR D241).
 *
 * Spans:
 *   - `workflow.run` — root span per `Workflow.run` invocation
 *   - `workflow.step.<id>` — child span per step (retry attempts share the kind)
 *
 * Attributes:
 *   - `workflow.name`, `workflow.run_id`, `step.kind`, `step.status`, `step.attempts`
 *
 * @internal
 */

import {
  getTracer,
  noopSpan,
  resetTracerCacheForTests,
  type SpanLike,
} from "../observability/tracer-loader.js";

const TRACER_NAME = "@theokit/sdk/workflow";

export function startWorkflowRunSpan(info: { workflowName: string; runId: string }): SpanLike {
  const tracer = getTracer(TRACER_NAME);
  if (tracer === undefined) return noopSpan;
  return tracer.startSpan("workflow.run", {
    attributes: {
      "workflow.name": info.workflowName,
      "workflow.run_id": info.runId,
    },
  });
}

export function startWorkflowStepSpan(info: {
  stepId: string;
  kind: string;
  attempt: number;
}): SpanLike {
  const tracer = getTracer(TRACER_NAME);
  if (tracer === undefined) return noopSpan;
  return tracer.startSpan(`workflow.step.${info.stepId}`, {
    attributes: {
      "step.id": info.stepId,
      "step.kind": info.kind,
      "step.attempt": info.attempt,
    },
  });
}

/** Test seam — reset tracer cache so a fresh require attempt happens. */
export function __resetTelemetryCacheForTests(): void {
  resetTracerCacheForTests();
}
