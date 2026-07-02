import { createRequire } from "node:module";

import type { ZodType } from "zod";

// `jsonrepair` is loaded lazily — consumers who never set `repairJson: true` never pay its
// module-parse cost. Unlike `zod` (an optional peer dep), `jsonrepair` is a direct dependency and
// is always installed; the lazy load is a startup-cost optimization, not an optional-install story.
// Cached after the first repair.
let cachedJsonrepair: ((text: string) => string) | undefined;
function loadJsonrepair(): (text: string) => string {
  if (cachedJsonrepair === undefined) {
    const req = createRequire(import.meta.url);
    cachedJsonrepair = (req("jsonrepair") as { jsonrepair: (t: string) => string }).jsonrepair;
  }
  return cachedJsonrepair;
}

/** @internal */
export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Number coercion with a round-trip + finite guard: rejects big-ints, leading-zeros, `NaN`,
 *  `Infinity`, and non-canonical forms (`"1e3"`), preventing silent ID/precision corruption (EC-2). */
function toFiniteNumber(raw: string): number | undefined {
  if (raw === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && String(n) === raw ? n : undefined;
}

/** Parse a value ONLY when it looks like a JSON object/array (EC-3 guard; leading whitespace
 *  ignored so `trim:false` inputs are still gated correctly). `repair` routes it through
 *  `jsonrepair` first. Returns `undefined` when not JSON-looking or on parse failure.
 *  @internal */
export function tryJson(raw: string, repair: boolean): unknown {
  const t = raw.trimStart();
  if (!(t.startsWith("{") || t.startsWith("["))) return undefined;
  try {
    return JSON.parse(repair ? loadJsonrepair()(t) : t);
  } catch {
    return undefined;
  }
}

/** Heuristic scalar/JSON coercion (agentfw `coerceParameter` shape) used when there is no
 *  per-field schema. Returns the coerced value, or the raw string when nothing applies.
 *  @internal */
export function heuristicCoerce(raw: string, repairJson: boolean): unknown {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null") return null;
  const n = toFiniteNumber(raw);
  if (n !== undefined) return n;
  const json = tryJson(raw, false) ?? (repairJson ? tryJson(raw, true) : undefined);
  return json === undefined ? raw : json;
}

/** Candidates a raw string could coerce to, most-specific first. Used for schema-aware coercion:
 *  the field schema selects the first candidate it accepts (so a string field keeps `"5"`).
 *  @internal */
export function coerceCandidates(raw: string, repairJson: boolean): unknown[] {
  const out: unknown[] = [];
  if (raw === "true") out.push(true);
  else if (raw === "false") out.push(false);
  else if (raw === "null") out.push(null);
  const n = toFiniteNumber(raw);
  if (n !== undefined) out.push(n);
  const json = tryJson(raw, false) ?? (repairJson ? tryJson(raw, true) : undefined);
  if (json !== undefined) out.push(json);
  out.push(raw); // raw string is always the last-resort candidate
  return out;
}

/** True for a Zod schema that exposes a per-key `.shape` (a `z.object`, incl. Zod-v4
 *  `.refine()`/`.default()` which keep `.shape`); non-object schemas (union/record) return
 *  `undefined` so callers fall back to heuristic coercion (EC-4).
 *  @internal */
export function objectShape(schema: ZodType | undefined): Record<string, ZodType> | undefined {
  const shape = (schema as unknown as { shape?: unknown } | undefined)?.shape;
  return shape !== null && typeof shape === "object"
    ? (shape as Record<string, ZodType>)
    : undefined;
}
