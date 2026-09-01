import type { ZodType } from "zod";

/**
 * Options for {@link sanitizeToolInput}. Trim is the only default-on rung — coercion and JSON
 * repair change a value's representation, so they are opt-in (the SDK's "values are strings; Zod
 * coerces" boundary; see `define-tool.ts` doc-comment).
 *
 * @public
 */
export interface SanitizeOptions {
  /** Trim leading/trailing whitespace from string values. Default `true`. */
  trim?: boolean;
  /** Coerce string values to typed values (`"5"`→`5`, `"true"`→`true`, `"null"`→`null`, JSON). Default `false`. */
  coerce?: boolean;
  /** Repair-then-parse malformed JSON-looking string values (via `jsonrepair`). Default `false`. */
  repairJson?: boolean;
  /**
   * Optional Zod schema. When it is a `z.object(...)`, coercion is schema-aware: each TOP-LEVEL
   * field is coerced only toward a candidate its field-schema accepts (so a `z.string()` field
   * keeps `"5"` as a string). Non-object schemas (union/record) fall back to heuristic coercion.
   * Note: with `deep: true`, nested fields always use heuristic coercion (the schema is not
   * descended into).
   */
  schema?: ZodType;
  /**
   * Recurse into nested plain objects. Default `false` (shallow).
   *
   * ARRAYS ARE NOT GATED BY THIS. Their string elements are sanitized by whichever rungs are on —
   * `trim` is on by default — because a value does not stop being a string by sitting in a list, and
   * a caller who saw `{ tag: "  a  " }` trimmed has no reason to expect `{ tags: ["  a  "] }` left
   * alone. What `deep` gates is descending into OBJECTS, wherever they are: at the top level, nested,
   * or inside an array.
   */
  deep?: boolean;
  /**
   * Max recursion depth. Default `8`.
   *
   * Counts every hop, array or object, so a deeply nested structure cannot recurse without bound even
   * when `deep` is off — array descent is not gated by `deep`, and this is what bounds it.
   */
  maxDepth?: number;
}

/**
 * Result of {@link sanitizeToolInput}. `value` is the sanitized copy; `changed` is true when any
 * value was altered; `notes` records a human-readable line per change (for logging/debugging).
 *
 * @public
 */
export interface SanitizeResult<T = Record<string, unknown>> {
  value: T;
  changed: boolean;
  notes: string[];
}
