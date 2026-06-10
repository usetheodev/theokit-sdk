import "reflect-metadata";

import { METADATA_KEYS } from "@theokit/di";

export interface UseSandboxOptions {
  backend?: "local" | "docker" | string;
  workDir?: string;
  timeoutMs?: number;
}

export function UseSandbox(options: UseSandboxOptions = {}): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    const existing: Map<string | symbol, UseSandboxOptions> =
      Reflect.getMetadata(METADATA_KEYS.SANDBOX, target.constructor) ?? new Map();
    existing.set(propertyKey, options);
    Reflect.defineMetadata(METADATA_KEYS.SANDBOX, existing, target.constructor);
  };
}

export function readSandboxMetadata(
  target: abstract new (...args: never) => unknown,
): ReadonlyMap<string | symbol, UseSandboxOptions> {
  return Reflect.getMetadata(METADATA_KEYS.SANDBOX, target) ?? new Map();
}
