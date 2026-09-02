import type { ZodType } from "zod";

import {
  coerceCandidates,
  heuristicCoerce,
  isPlainObject,
  objectShape,
  tryJson,
} from "./coerce.js";
import type { SanitizeOptions, SanitizeResult } from "./types.js";

interface Ctx {
  trim: boolean;
  coerce: boolean;
  repairJson: boolean;
  deep: boolean;
  maxDepth: number;
  shape: Record<string, ZodType> | undefined;
  notes: string[];
}

/** Trim rung — returns the trimmed string, noting the change. */
function applyTrim(key: string, value: string, ctx: Ctx): string {
  const trimmed = value.trim();
  if (trimmed !== value) ctx.notes.push(`trimmed "${key}"`);
  return trimmed;
}

/** Coerce rung — schema-aware when a field schema exists (pick the first accepted candidate),
 *  else heuristic. Returns the coerced value (or the raw string), noting the change. */
function applyCoerce(key: string, raw: string, ctx: Ctx): unknown {
  const field = ctx.shape?.[key];
  let coerced: unknown = raw;
  if (field) {
    for (const candidate of coerceCandidates(raw, ctx.repairJson)) {
      if (field.safeParse(candidate).success) {
        coerced = candidate;
        break;
      }
    }
  } else {
    coerced = heuristicCoerce(raw, ctx.repairJson);
  }
  if (coerced !== raw) ctx.notes.push(`coerced "${key}"`);
  return coerced;
}

/** Repair rung — repair-then-parse a JSON-looking string, noting the change. */
function applyRepair(key: string, value: string, ctx: Ctx): unknown {
  const repaired = tryJson(value, true);
  if (repaired === undefined) return value;
  ctx.notes.push(`repaired json "${key}"`);
  return repaired;
}

/** Sanitize one string value through the enabled rungs (trim → coerce → repair). */
function sanitizeString(key: string, value: string, ctx: Ctx): unknown {
  let out: unknown = ctx.trim ? applyTrim(key, value, ctx) : value;
  if (ctx.coerce && typeof out === "string") out = applyCoerce(key, out, ctx);
  // Standalone repair runs ONLY when coerce is off. When coerce is on it already embedded the
  // repair candidate (via coerceCandidates / heuristicCoerce), and a schema-confirmed raw string
  // (e.g. a JSON string a `z.string()` field accepted) must not be clobbered back into an object.
  if (ctx.repairJson && !ctx.coerce && typeof out === "string") out = applyRepair(key, out, ctx);
  return out;
}

/**
 * Sanitize one value, whatever shape it has.
 *
 * Arrays used to fall through to "assign as-is", so `{ tags: ["  a  " ] }` came back untouched while
 * `{ tag: "  a  " }` was trimmed — even though trim is on by default and the `@public` docblock on
 * `deep` promised recursion into "objects/arrays". Nothing in the type distinguished the two cases.
 *
 * The element rules are the SAME rules, deliberately: a string element is sanitized like a string
 * field, and an object element is descended only under `deep`, so a caller does not have to learn a
 * second set of semantics for values that happen to sit in a list. `map` rather than the object
 * walker, because reusing that would return `{ "0": … }` and a handler doing `Array.isArray` would
 * reject it.
 */
function walkValue(key: string, value: unknown, ctx: Ctx, depth: number): unknown {
  if (typeof value === "string") return sanitizeString(key, value, ctx);
  if (Array.isArray(value)) {
    if (depth >= ctx.maxDepth) return value;
    return value.map((element) => walkValue(key, element, ctx, depth + 1));
  }
  if (ctx.deep && depth < ctx.maxDepth && isPlainObject(value)) return walk(value, ctx, depth + 1);
  return value;
}

function walk(input: Record<string, unknown>, ctx: Ctx, depth: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    out[key] = walkValue(key, value, ctx, depth);
  }
  return out;
}

/**
 * Sanitize the raw arguments a model emitted for a tool call — trim (default), optionally coerce
 * string values toward their expected type, optionally repair malformed JSON. Pure, synchronous,
 * and TOTAL: it never throws (non-object input is returned unchanged) and never changes a value's
 * meaning — only its hygiene/representation. Reused internally by the leaked-dialect recovery so
 * the public primitive and the internal path never diverge.
 *
 * @public
 */
export function sanitizeToolInput(
  input: Record<string, unknown>,
  options?: SanitizeOptions,
): SanitizeResult {
  // EC-1 — total contract: a non-object (null / array / primitive) is returned as-is, never thrown on.
  if (!isPlainObject(input)) return { value: input, changed: false, notes: [] };
  const ctx: Ctx = {
    trim: options?.trim ?? true,
    coerce: options?.coerce ?? false,
    repairJson: options?.repairJson ?? false,
    deep: options?.deep ?? false,
    maxDepth: options?.maxDepth ?? 8,
    shape: objectShape(options?.schema),
    notes: [],
  };
  const value = walk(input, ctx, 0);
  return { value, changed: ctx.notes.length > 0, notes: ctx.notes };
}
