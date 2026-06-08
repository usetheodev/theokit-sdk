/**
 * TTL string parser. Accepts:
 *   - number → treated as SECONDS
 *   - string `"\d+(s|m|h|d|w)"` → seconds/minutes/hours/days/weeks
 *
 * EC-8: `"0s"` / `0` returns 0 (effectively disables cache for that entry).
 *       Negative numbers throw `CacheInvalidTtlError`.
 *
 * @internal
 */

import { CacheInvalidTtlError } from "../types/cache.js";

const TTL_PATTERN = /^(\d+)\s*(s|m|h|d|w)$/i;

export function parseTtlMs(input: string | number): number {
  if (typeof input === "number") {
    if (!Number.isFinite(input) || input < 0) {
      throw new CacheInvalidTtlError(input);
    }
    return Math.floor(input * 1000);
  }
  const trimmed = input.trim();
  const m = TTL_PATTERN.exec(trimmed);
  if (m === null) {
    throw new CacheInvalidTtlError(input);
  }
  const value = Number(m[1]);
  const unit = m[2]!.toLowerCase();
  switch (unit) {
    case "s":
      return value * 1000;
    case "m":
      return value * 60_000;
    case "h":
      return value * 3_600_000;
    case "d":
      return value * 86_400_000;
    case "w":
      return value * 604_800_000;
    /* c8 ignore next 2 */
    default:
      throw new CacheInvalidTtlError(input);
  }
}
