/**
 * M2 #63 — shared pagination helper for conversation storage adapters.
 * Neutral module so the in-memory adapter does not import the fs adapter (which
 * would pull `node:fs` into an fs-less context) just to reach this pure function.
 *
 * @internal
 */

import { ConfigurationError } from "../../errors.js";

/**
 * Apply an optional `{ offset, limit }` window to an ordered list.
 * `undefined` opts returns the list unchanged; undefined offset ⇒ 0; undefined
 * limit ⇒ to the end. An out-of-range (but valid) offset yields an empty slice.
 *
 * Invalid input FAILS FAST (error-handling.md): `offset`/`limit` must be a
 * non-negative integer — a `NaN`, negative, fractional, or non-finite value is a
 * caller mistake and throws `ConfigurationError` rather than being silently
 * coerced (a `NaN` offset previously returned the whole list).
 */
export function paginate<T>(
  items: readonly T[],
  opts?: { offset?: number; limit?: number },
): readonly T[] {
  if (opts === undefined || (opts.offset === undefined && opts.limit === undefined)) return items;
  const start = opts.offset === undefined ? 0 : requireNonNegativeInt(opts.offset, "offset");
  const limit = opts.limit === undefined ? undefined : requireNonNegativeInt(opts.limit, "limit");
  const end = limit === undefined ? items.length : start + limit;
  return items.slice(start, end);
}

function requireNonNegativeInt(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new ConfigurationError(
      `Invalid pagination ${field}: expected a non-negative integer, got ${value}`,
      { code: "pagination_invalid" },
    );
  }
  return value;
}
