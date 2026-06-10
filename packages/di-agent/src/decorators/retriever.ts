import "reflect-metadata";
import { METADATA_KEYS } from "@theokit/di";

export interface RetrieverOptions {
  topK?: number;
  threshold?: number;
}

export function Retriever(options: RetrieverOptions): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    const existing: Map<string | symbol, RetrieverOptions> =
      Reflect.getMetadata(METADATA_KEYS.RETRIEVER, target.constructor) ?? new Map();
    existing.set(propertyKey, options);
    Reflect.defineMetadata(METADATA_KEYS.RETRIEVER, existing, target.constructor);
  };
}

export function readRetrieverMetadata(
  target: abstract new (...args: never) => unknown,
): ReadonlyMap<string | symbol, RetrieverOptions> {
  return Reflect.getMetadata(METADATA_KEYS.RETRIEVER, target) ?? new Map();
}
