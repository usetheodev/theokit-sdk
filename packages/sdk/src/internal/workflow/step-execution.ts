/**
 * The state every composite step runner threads to the next one.
 *
 * Nine runners in this directory declared the SAME list as positional parameters —
 * `(step, input, ctx, options, prevStepResults, dispatch)` — six or seven wide against the
 * consensus ceiling of four (Clean Code ch. 3). That is not nine style nits: it is one context
 * object that was never named, re-declared once per step kind, so adding a field to the execution
 * state means touching every arm and any two adjacent slots of compatible type transpose silently.
 *
 * `prevStepResults` is part of it and still varies per call — a nested sequence dispatches its inner
 * steps with an EMPTY list, because "previous steps" means the enclosing sequence's, not the outer
 * workflow's. That override is now written as `{ ...exec, prevStepResults: [] }`, which says what it
 * does, where before it was a bare `[]` in the fifth position.
 *
 * @internal
 */

import type { Step, StepContext, StepResult, WorkflowOptions } from "../../types/workflow.js";

export interface StepExecution {
  readonly ctx: StepContext;
  readonly options: WorkflowOptions;
  /** Results of the steps already finished in THIS sequence — `[]` inside a nested one. */
  readonly prevStepResults: ReadonlyArray<StepResult>;
  readonly dispatch: DispatchFn;
}

/** Runs one step of any kind. Recursive: composite steps dispatch their children through it. */
export type DispatchFn = (step: Step, input: unknown, exec: StepExecution) => Promise<StepResult>;
