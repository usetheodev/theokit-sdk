/**
 * Single source of truth for the metadata keys our decorators write and
 * the container reads. Keeping them here means container.ts and
 * decorators/*.ts agree on the wire format.
 */

import type { ClassConstructor, Scope, Token } from "../types.js";

export const METADATA_KEYS = {
  /** Marker that a class was decorated with `@Injectable()`. */
  INJECTABLE: "usetheo:di:injectable",
  /** Map<number, Token> from `@Inject(token)` parameter decorators. */
  INJECT_TOKENS: "usetheo:di:inject-tokens",
  /** Set<number> from `@Optional()` parameter decorators. */
  OPTIONAL_FLAGS: "usetheo:di:optional",
  /** TS-emitted constructor parameter types (requires `emitDecoratorMetadata`). */
  DESIGN_PARAMTYPES: "design:paramtypes",
} as const;

export interface InjectableMetadata {
  scope?: Scope;
}

/**
 * Probe whether `reflect-metadata` is loaded. Returns `false` if `Reflect`
 * lacks the `getMetadata` function the polyfill installs.
 */
export function hasReflectMetadata(): boolean {
  return (
    typeof Reflect !== "undefined" &&
    typeof (Reflect as unknown as { getMetadata?: unknown }).getMetadata === "function"
  );
}

/**
 * Read constructor param types emitted by `emitDecoratorMetadata`.
 * Returns `[]` if the class was not decorated OR `emitDecoratorMetadata`
 * is off in the consumer's tsconfig.
 */
export function readParamTypes(target: ClassConstructor): ReadonlyArray<unknown> {
  if (!hasReflectMetadata()) return [];
  const out = Reflect.getMetadata(METADATA_KEYS.DESIGN_PARAMTYPES, target) as unknown;
  if (!Array.isArray(out)) return [];
  return out;
}

/**
 * Read explicit `@Inject(token)` overrides keyed by constructor parameter
 * index.
 */
export function readInjectTokens(target: ClassConstructor): ReadonlyMap<number, Token> {
  if (!hasReflectMetadata()) return new Map();
  const out = Reflect.getMetadata(METADATA_KEYS.INJECT_TOKENS, target) as unknown;
  if (!(out instanceof Map)) return new Map();
  return out as ReadonlyMap<number, Token>;
}

/**
 * Read `@Optional()` flags keyed by constructor parameter index.
 */
export function readOptionalFlags(target: ClassConstructor): ReadonlySet<number> {
  if (!hasReflectMetadata()) return new Set();
  const out = Reflect.getMetadata(METADATA_KEYS.OPTIONAL_FLAGS, target) as unknown;
  if (!(out instanceof Set)) return new Set();
  return out as ReadonlySet<number>;
}

/**
 * Read `@Injectable({ scope })` metadata. Returns `undefined` if the class
 * was not decorated. The container then checks `isInjectable()` (or treats
 * it as a registration error per v1.1 EC-1).
 */
export function readInjectableMetadata(target: ClassConstructor): InjectableMetadata | undefined {
  if (!hasReflectMetadata()) return undefined;
  const out = Reflect.getMetadata(METADATA_KEYS.INJECTABLE, target) as unknown;
  if (out === undefined || out === null) return undefined;
  if (typeof out !== "object") return undefined;
  return out as InjectableMetadata;
}

/**
 * Whether the class was decorated with `@Injectable()` at all.
 */
export function isInjectable(target: ClassConstructor): boolean {
  return readInjectableMetadata(target) !== undefined;
}

/**
 * Detect primitive wrapper types (`Number`, `String`, `Boolean`, `Object`).
 * TS emits these for primitive constructor parameters and for interface
 * parameters that can't be resolved at runtime. The container uses this
 * to emit better errors than "TokenNotFoundError: Number" (v1.1 EC-6).
 */
const PRIMITIVE_WRAPPERS: ReadonlySet<unknown> = new Set([
  Number,
  String,
  Boolean,
  Object,
  Array,
  Function,
]);

export function isPrimitiveTypeMarker(value: unknown): boolean {
  return typeof value === "function" && PRIMITIVE_WRAPPERS.has(value);
}
