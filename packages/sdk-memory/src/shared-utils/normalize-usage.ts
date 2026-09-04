/**
 * Shared usage normalization logic.
 * Canonical implementation (consolidated from 336L duplicate).
 * @internal
 */

export function normalizeUsage(raw: any) {
  return {
    tokens: raw.tokens || 0,
    cost: raw.cost || 0,
    duration: raw.duration || 0,
  };
}
