/**
 * M2 #63 — shared pagination helper for conversation storage adapters.
 * Neutral module so the in-memory adapter does not import the fs adapter (which
 * would pull `node:fs` into an fs-less context) just to reach this pure function.
 *
 * @internal
 */

/**
 * Apply an optional `{ offset, limit }` window to an ordered list.
 * `undefined` opts returns the list unchanged. Negative/undefined offset ⇒ 0;
 * undefined limit ⇒ to the end. Out-of-range offset yields an empty slice.
 */
export function paginate<T>(
  items: readonly T[],
  opts?: { offset?: number; limit?: number },
): readonly T[] {
  if (opts === undefined || (opts.offset === undefined && opts.limit === undefined)) return items;
  const start = Math.max(0, opts.offset ?? 0);
  const end = opts.limit === undefined ? items.length : start + Math.max(0, opts.limit);
  return items.slice(start, end);
}
