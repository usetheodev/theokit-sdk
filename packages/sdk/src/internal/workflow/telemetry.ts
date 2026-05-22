/**
 * OTel telemetry for workflows (ADR D241). Lazy load via `createRequire`
 * so users without `@opentelemetry/api` installed pay zero cost.
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

import { createRequire } from "node:module";

interface SpanLike {
  setAttribute(key: string, value: string | number | boolean): SpanLike;
  end(): void;
}

const noopSpan: SpanLike = {
  setAttribute: () => noopSpan,
  end: () => undefined,
};

interface TracerLike {
  startSpan(
    name: string,
    options?: { attributes?: Record<string, string | number | boolean> },
  ): SpanLike;
}

let cachedTracer: TracerLike | undefined | null = undefined;

function getTracer(): TracerLike | undefined {
  if (cachedTracer === null) return undefined;
  if (cachedTracer !== undefined) return cachedTracer;
  try {
    const r = createRequire(import.meta.url);
    const otel = r("@opentelemetry/api") as {
      trace?: { getTracer: (name: string, version?: string) => TracerLike };
    };
    if (otel.trace?.getTracer === undefined) {
      cachedTracer = null;
      return undefined;
    }
    cachedTracer = otel.trace.getTracer("@usetheo/sdk/workflow", "1.0.0");
    return cachedTracer;
  } catch {
    cachedTracer = null;
    return undefined;
  }
}

export function startWorkflowRunSpan(info: {
  workflowName: string;
  runId: string;
}): SpanLike {
  const tracer = getTracer();
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
  const tracer = getTracer();
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
  cachedTracer = undefined;
}
