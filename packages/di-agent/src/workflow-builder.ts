/**
 * `buildWorkflow` — compile a `@Step`-decorated class instance into a
 * `@theokit/sdk` `Workflow`.
 *
 * This is the materializer/bridge for the decorator-driven workflow authoring
 * surface (cross-val Gap 2). It COMPOSES the existing `Workflow` engine — it
 * adds no orchestration logic of its own (same principle as `createSquad`).
 * Steps are topologically ordered by their single `after` dependency into a
 * linear `Workflow.then(...)` chain; each step's return value is threaded into
 * the next step. Branching/fan-out remains the imperative `Workflow` surface.
 *
 * NOTE: this module (unlike the metadata-only decorators) imports the
 * `@theokit/sdk` peer dependency — it is the bridge layer.
 */

import { fn, Workflow } from "@theokit/sdk/workflow";
import { readStepMetadata, type StepMetadata } from "./decorators/step.js";
import { readWorkflowMetadata } from "./decorators/workflow.js";

interface ResolvedStep {
  key: string;
  id: string;
  after?: string;
  run: (input: unknown) => unknown;
}

/**
 * Build a `Workflow` from a `@Step`-decorated instance. Validates the step
 * graph (fail-fast) before constructing the workflow.
 *
 * @throws Error when there are no `@Step` methods, an `after` references an
 *   unknown step, or the `after` graph contains a cycle.
 */
export function buildWorkflow(instance: object): Workflow {
  const ctor = instance.constructor as abstract new (...args: never) => unknown;
  const meta = readStepMetadata(ctor);
  if (meta.size === 0) {
    throw new Error(`buildWorkflow: class "${instance.constructor.name}" has no @Step methods`);
  }

  const steps = resolveSteps(instance, meta);
  validateAfterTargets(steps);
  const ordered = topoSort(steps);

  const name = readWorkflowMetadata(instance.constructor as Function)?.name ?? "workflow";
  let builder = Workflow.create({ name });
  for (const s of ordered) {
    builder = builder.then(fn(s.id, (input: unknown) => s.run(input)));
  }
  return builder.commit();
}

/** Resolve each `@Step` method into a runnable {@link ResolvedStep}. */
function resolveSteps(
  instance: object,
  meta: ReadonlyMap<string | symbol, StepMetadata>,
): Map<string, ResolvedStep> {
  const steps = new Map<string, ResolvedStep>();
  for (const [key, m] of meta) {
    const k = String(key);
    const method = (instance as Record<string, unknown>)[k];
    if (typeof method !== "function") {
      throw new Error(`buildWorkflow: @Step "${k}" is not a method`);
    }
    steps.set(k, {
      key: k,
      id: m.name ?? k,
      after: m.after,
      run: (input: unknown) => (method as (i: unknown) => unknown).call(instance, input),
    });
  }
  return steps;
}

/** Fail-fast if any `after` references a step that does not exist. */
function validateAfterTargets(steps: Map<string, ResolvedStep>): void {
  for (const s of steps.values()) {
    if (s.after !== undefined && !steps.has(s.after)) {
      throw new Error(
        `buildWorkflow: @Step "${s.key}" declares after: "${s.after}" which is not a known @Step (unknown upstream)`,
      );
    }
  }
}

/**
 * Topologically order steps by their single `after` dependency. Entry steps
 * (no `after`) come first in declaration order; each dependent follows its
 * upstream. Throws on a cycle.
 */
function topoSort(steps: Map<string, ResolvedStep>): ResolvedStep[] {
  const ordered: ResolvedStep[] = [];
  const placed = new Set<string>();
  const visiting = new Set<string>();

  const visit = (s: ResolvedStep): void => {
    if (placed.has(s.key)) return;
    if (visiting.has(s.key)) {
      throw new Error(`buildWorkflow: cycle detected in @Step "after" graph at "${s.key}"`);
    }
    visiting.add(s.key);
    if (s.after !== undefined) {
      const up = steps.get(s.after);
      if (up !== undefined) visit(up);
    }
    visiting.delete(s.key);
    placed.add(s.key);
    ordered.push(s);
  };

  for (const s of steps.values()) visit(s);
  return ordered;
}
