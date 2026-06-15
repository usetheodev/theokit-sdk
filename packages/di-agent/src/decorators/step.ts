import "reflect-metadata";

import { METADATA_KEYS } from "@theokit/di";

/**
 * Metadata captured by the `@Step()` method decorator. Declares one step of a
 * decorator-driven workflow and its single upstream dependency. Compiled into
 * a `@theokit/sdk` `Workflow` by `buildWorkflow` (decorator mandate — every
 * agentic capability ships a decorator alongside the factory/builder).
 */
export interface StepMetadata {
  /**
   * Method name of the upstream step this step runs after. Omitted = entry
   * step (receives the workflow input). MVP supports a single dependency
   * (linear chain); branching/fan-out stays the imperative `Workflow` surface.
   */
  after?: string;
  /** Optional step id (defaults to the method name). */
  name?: string;
}

/**
 * `@Step(metadata?)` — mark a class method as a workflow step. The method
 * receives the upstream step's return value (or the workflow input for an
 * entry step) and returns this step's output.
 */
export function Step(metadata: StepMetadata = {}): MethodDecorator {
  return (target: object, propertyKey: string | symbol) => {
    const existing: Map<string | symbol, StepMetadata> =
      Reflect.getMetadata(METADATA_KEYS.STEP, target.constructor) ?? new Map();
    existing.set(propertyKey, metadata);
    Reflect.defineMetadata(METADATA_KEYS.STEP, existing, target.constructor);
  };
}

/** Read `@Step()` metadata off a class constructor (insertion-ordered). */
export function readStepMetadata(
  target: abstract new (...args: never) => unknown,
): ReadonlyMap<string | symbol, StepMetadata> {
  return Reflect.getMetadata(METADATA_KEYS.STEP, target) ?? new Map();
}
