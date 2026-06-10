import "reflect-metadata";
import { METADATA_KEYS } from "@theokit/di";

export interface ToolOptions {
  name: string;
  description: string;
  inputSchema?: unknown;
}

export function Tool(options: ToolOptions): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    const existing: Map<string | symbol, ToolOptions> =
      Reflect.getMetadata(METADATA_KEYS.TOOL, target.constructor) ?? new Map();
    existing.set(propertyKey, options);
    Reflect.defineMetadata(METADATA_KEYS.TOOL, existing, target.constructor);
  };
}

export function readToolMetadata(
  target: abstract new (...args: never) => unknown,
): ReadonlyMap<string | symbol, ToolOptions> {
  return Reflect.getMetadata(METADATA_KEYS.TOOL, target) ?? new Map();
}
