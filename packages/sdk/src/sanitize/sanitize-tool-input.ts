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
  if (ctx.repairJson && typeof out === "string") out = applyRepair(key, out, ctx);
  return out;
}

function walk(input: Record<string, unknown>, ctx: Ctx, depth: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string") out[key] = sanitizeString(key, value, ctx);
    else if (ctx.deep && depth < ctx.maxDepth && isPlainObject(value))
      out[key] = walk(value, ctx, depth + 1);
    else out[key] = value;
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
