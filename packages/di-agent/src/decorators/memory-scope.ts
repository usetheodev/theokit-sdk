import "reflect-metadata";

import { METADATA_KEYS } from "@theokit/di";

export interface MemoryScopeOptions {
  path: string;
}

export function MemoryScopeDecorator(options: MemoryScopeOptions): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    const existing: Map<string | symbol, MemoryScopeOptions> =
      Reflect.getMetadata(METADATA_KEYS.MEMORY_SCOPE, target.constructor) ?? new Map();
    existing.set(propertyKey, options);
    Reflect.defineMetadata(METADATA_KEYS.MEMORY_SCOPE, existing, target.constructor);
  };
}

export function readMemoryScopeMetadata(
  target: abstract new (...args: never) => unknown,
): ReadonlyMap<string | symbol, MemoryScopeOptions> {
  return Reflect.getMetadata(METADATA_KEYS.MEMORY_SCOPE, target) ?? new Map();
}
