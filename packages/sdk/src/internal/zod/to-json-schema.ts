/**
 * Zod v4 → JSON Schema adapter.
 *
 * Uses Zod v4's native `z.toJSONSchema()` directly. The v3 fallback path
 * was removed after the zod-v4-migration plan (ADR D2) locked the workspace
 * to `zod ^4.0.0` only — the `zod-to-json-schema` peer dep is no longer
 * needed.
 *
 * @internal
 */

import { toJSONSchema } from "zod";

interface ToJsonSchemaOptions {
  /** `"any"` keeps transforms/refinements as `{}` (loose). Default: `"any"`. */
  unrepresentable?: "any" | "throw";
}

/**
 * Convert a Zod schema to a JSON Schema object via Zod v4 native.
 *
 * Accepts `unknown` because callers pass `T extends ZodType` generics that
 * don't structurally satisfy Zod v4's `$ZodType` parameter. The cast is
 * safe: any schema created by `z.object()` / `z.string()` etc. IS a valid
 * input to `toJSONSchema` at runtime.
 *
 * @internal
 */
export function toJsonSchema(
  schema: unknown,
  options: ToJsonSchemaOptions = { unrepresentable: "any" },
): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic ZodType erasure
  return toJSONSchema(schema as any, options) as Record<string, unknown>;
}
