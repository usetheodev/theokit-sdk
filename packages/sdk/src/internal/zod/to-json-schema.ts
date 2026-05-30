/**
 * Zod → JSON Schema universal adapter (FAANG-grade, supports Zod 3 + Zod 4).
 *
 * The SDK declares `zod: "^3.25.0 || ^4.0.0"` as optional peer. Implementation
 * MUST work on both versions or the peer-range claim is false.
 *
 * Strategy:
 *   1. Feature-detect Zod 4's native `z.toJSONSchema` (preferred — zero extra
 *      dep, ships with Zod 4 core).
 *   2. Fall back to the universal `zod-to-json-schema` library (works for both
 *      v3 and v4; ~5KB gzipped, optional peer dep).
 *   3. If neither path resolves, throw an actionable error explaining the
 *      install command for the user's Zod major.
 *
 * Output shape is identical across paths: a `Record<string, unknown>` JSON
 * Schema document with `type: "object"` root that the LLM tool-use spec
 * accepts unchanged.
 *
 * @internal
 */

import { createRequire } from "node:module";

type AnyZodSchema = unknown;

interface ToJsonSchemaOptions {
  /** Zod 4 option: `"any"` keeps transforms/refinements as `{}` (loose). */
  unrepresentable?: "any" | "throw";
}

const requireSdk = createRequire(import.meta.url);

let cachedZodHasNativeApi: boolean | undefined;
let cachedFallbackLib: ((schema: AnyZodSchema) => unknown) | undefined;
let triedFallback = false;

/**
 * Convert any Zod schema (v3 or v4) to a JSON Schema object. Feature-detects
 * the native Zod 4 API first; falls back to `zod-to-json-schema` lib on v3.
 *
 * @internal
 */
export function toJsonSchema(
  schema: AnyZodSchema,
  options: ToJsonSchemaOptions = { unrepresentable: "any" },
): Record<string, unknown> {
  const native = tryNativeZod4(schema, options);
  if (native !== undefined) return native;
  const fallback = tryFallbackLib(schema);
  if (fallback !== undefined) return fallback;
  throw new Error(
    "Zod → JSON Schema conversion failed: neither Zod 4's native `z.toJSONSchema` " +
      "nor the `zod-to-json-schema` peer dep are available. " +
      "On Zod 4: ensure `zod >= 4.0.0` is installed. " +
      'On Zod 3: add `"zod-to-json-schema": "^3.24.0"` to your package.json.',
  );
}

function tryNativeZod4(
  schema: AnyZodSchema,
  options: ToJsonSchemaOptions,
): Record<string, unknown> | undefined {
  if (cachedZodHasNativeApi === false) return undefined;
  let z: { toJSONSchema?: (s: unknown, o?: unknown) => unknown };
  try {
    z = requireSdk("zod") as typeof z;
  } catch {
    cachedZodHasNativeApi = false;
    return undefined;
  }
  if (typeof z.toJSONSchema !== "function") {
    cachedZodHasNativeApi = false;
    return undefined;
  }
  cachedZodHasNativeApi = true;
  return z.toJSONSchema(schema, options) as Record<string, unknown>;
}

function tryFallbackLib(schema: AnyZodSchema): Record<string, unknown> | undefined {
  if (cachedFallbackLib !== undefined) {
    return cachedFallbackLib(schema) as Record<string, unknown>;
  }
  if (triedFallback) return undefined;
  triedFallback = true;
  try {
    // `zod-to-json-schema` exports the converter as default OR as named export
    // `zodToJsonSchema` depending on module shape. Probe both.
    const mod = requireSdk("zod-to-json-schema") as {
      default?: (s: unknown) => unknown;
      zodToJsonSchema?: (s: unknown) => unknown;
    };
    const fn =
      typeof mod.zodToJsonSchema === "function"
        ? mod.zodToJsonSchema
        : typeof mod.default === "function"
          ? mod.default
          : undefined;
    if (fn === undefined) return undefined;
    cachedFallbackLib = fn as (s: AnyZodSchema) => unknown;
    return fn(schema) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/**
 * Test-only reset (clears the version-detection cache so tests can simulate
 * a different Zod major).
 *
 * @internal
 */
export function _resetZodToJsonSchemaCache(): void {
  cachedZodHasNativeApi = undefined;
  cachedFallbackLib = undefined;
  triedFallback = false;
}
