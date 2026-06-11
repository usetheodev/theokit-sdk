import "reflect-metadata";

import { METADATA_KEYS } from "@theokit/di";

export interface SubAgentOptions {
  name: string;
  description: string;
  instructions: string;
  model?: string;
  maxDelegationDepth?: number;
}

export function SubAgent(options: SubAgentOptions): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    const existing: Map<string | symbol, SubAgentOptions> =
      Reflect.getMetadata(METADATA_KEYS.SUBAGENT, target.constructor) ?? new Map();
    existing.set(propertyKey, options);
    Reflect.defineMetadata(METADATA_KEYS.SUBAGENT, existing, target.constructor);
  };
}

export function readSubAgentMetadata(
  target: abstract new (...args: never) => unknown,
): ReadonlyMap<string | symbol, SubAgentOptions> {
  return Reflect.getMetadata(METADATA_KEYS.SUBAGENT, target) ?? new Map();
}
