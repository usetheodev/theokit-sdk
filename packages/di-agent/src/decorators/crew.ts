import "reflect-metadata";

import { METADATA_KEYS } from "@theokit/di";

/**
 * Metadata captured by the `@Crew()` property decorator. Declares a sequential
 * agent team by referencing the agent property names that compose it. Mirrors
 * the `@theokit/sdk` `createCrew` factory (decorator mandate — every agentic
 * capability ships a decorator alongside the factory).
 */
export interface CrewMetadata {
  /** Agent property names (or ids) that run in order. */
  agents: string[];
  /** Orchestration process. Default (omitted) = `"sequential"`. */
  process?: "sequential" | "hierarchical";
  /** Optional crew name. */
  name?: string;
}

/**
 * `@Crew(metadata)` — declare a sequential agent team on a property. The DI
 * container / agent provider materializes it into a `createCrew(...)` at wiring
 * time.
 */
export function Crew(metadata: CrewMetadata): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    const existing: Map<string | symbol, CrewMetadata> =
      Reflect.getMetadata(METADATA_KEYS.CREW, target.constructor) ?? new Map();
    existing.set(propertyKey, metadata);
    Reflect.defineMetadata(METADATA_KEYS.CREW, existing, target.constructor);
  };
}

/** Read `@Crew()` metadata off a class constructor. */
export function readCrewMetadata(
  target: abstract new (...args: never) => unknown,
): ReadonlyMap<string | symbol, CrewMetadata> {
  return Reflect.getMetadata(METADATA_KEYS.CREW, target) ?? new Map();
}
