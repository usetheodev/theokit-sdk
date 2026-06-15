import "reflect-metadata";

import { METADATA_KEYS } from "@theokit/di";

/**
 * Metadata captured by the `@Squad()` property decorator. Declares a sequential
 * agent team by referencing the agent property names that compose it. Mirrors
 * the `@theokit/sdk` `createSquad` factory (decorator mandate — every agentic
 * capability ships a decorator alongside the factory).
 */
export interface SquadMetadata {
  /** Agent property names (or ids) that run in order. */
  agents: string[];
  /** Orchestration process. Default (omitted) = `"sequential"`. */
  process?: "sequential" | "hierarchical";
  /** Optional squad name. */
  name?: string;
}

/**
 * `@Squad(metadata)` — declare a sequential agent team on a property. The DI
 * container / agent provider materializes it into a `createSquad(...)` at wiring
 * time.
 */
export function Squad(metadata: SquadMetadata): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    const existing: Map<string | symbol, SquadMetadata> =
      Reflect.getMetadata(METADATA_KEYS.SQUAD, target.constructor) ?? new Map();
    existing.set(propertyKey, metadata);
    Reflect.defineMetadata(METADATA_KEYS.SQUAD, existing, target.constructor);
  };
}

/** Read `@Squad()` metadata off a class constructor. */
export function readSquadMetadata(
  target: abstract new (...args: never) => unknown,
): ReadonlyMap<string | symbol, SquadMetadata> {
  return Reflect.getMetadata(METADATA_KEYS.SQUAD, target) ?? new Map();
}
