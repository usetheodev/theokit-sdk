import "reflect-metadata";
import { METADATA_KEYS } from "@theokit/di";

export interface RerankerOptions {
  provider?: string;
  model?: string;
  topN?: number;
}

export function Reranker(options: RerankerOptions): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    const existing: Map<string | symbol, RerankerOptions> =
      Reflect.getMetadata(METADATA_KEYS.RERANKER, target.constructor) ?? new Map();
    existing.set(propertyKey, options);
    Reflect.defineMetadata(METADATA_KEYS.RERANKER, existing, target.constructor);
  };
}

export function readRerankerMetadata(
  target: abstract new (...args: never) => unknown,
): ReadonlyMap<string | symbol, RerankerOptions> {
  return Reflect.getMetadata(METADATA_KEYS.RERANKER, target) ?? new Map();
}
