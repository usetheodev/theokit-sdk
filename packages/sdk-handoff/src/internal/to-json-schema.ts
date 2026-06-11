/**
 * Zod v4 → JSON Schema adapter for sdk-handoff.
 *
 * Uses Zod v4's native `z.toJSONSchema()` directly. v3 fallback removed
 * after zod-v4-migration plan (ADR D2).
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
 * @internal
 */
export function toJsonSchema(
  schema: unknown,
  options: ToJsonSchemaOptions = { unrepresentable: "any" },
): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic ZodType erasure
  return toJSONSchema(schema as any, options) as Record<string, unknown>;
}
