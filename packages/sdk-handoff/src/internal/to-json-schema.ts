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
  // The schema param is `unknown` (callers pass `T extends ZodType` generics that
  // don't structurally satisfy Zod v4's `$ZodType`); cast to the exact parameter
  // type `toJSONSchema` expects rather than `any` — any z.* schema IS valid at runtime.
  return toJSONSchema(schema as Parameters<typeof toJSONSchema>[0], options) as Record<
    string,
    unknown
  >;
}
