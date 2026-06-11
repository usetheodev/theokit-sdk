import "reflect-metadata";
import { METADATA_KEYS } from "@theokit/di";

export interface TextSplitterOptions {
  strategy?: string;
  chunkSize?: number;
  overlap?: number;
}

export function TextSplitter(options: TextSplitterOptions): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    const existing: Map<string | symbol, TextSplitterOptions> =
      Reflect.getMetadata(METADATA_KEYS.TEXT_SPLITTER, target.constructor) ?? new Map();
    existing.set(propertyKey, options);
    Reflect.defineMetadata(METADATA_KEYS.TEXT_SPLITTER, existing, target.constructor);
  };
}

export function readTextSplitterMetadata(
  target: abstract new (...args: never) => unknown,
): ReadonlyMap<string | symbol, TextSplitterOptions> {
  return Reflect.getMetadata(METADATA_KEYS.TEXT_SPLITTER, target) ?? new Map();
}
