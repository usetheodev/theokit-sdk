/**
 * SE41 — Levenshtein edit distance for `Scorers.levenshtein`.
 *
 * Classic two-row dynamic-programming distance (O(n) memory). Callers MUST
 * bound input length via {@link LEVENSHTEIN_MAX_LEN} before calling — the
 * algorithm is O(n*m) time, so unbounded LLM output would be a DoS vector.
 *
 * @internal
 */

/** Max per-string length the fuzzy scorer will process (bounds O(n*m) cost). */
export const LEVENSHTEIN_MAX_LEN = 4000;

/** Compute DP row `i` from the previous row (extracted to keep each fn simple). */
function nextRow(prev: number[], rowIndex: number, ai: number, b: string): number[] {
  const curr: number[] = [rowIndex];
  for (let j = 1; j <= b.length; j += 1) {
    const cost = ai === b.charCodeAt(j - 1) ? 0 : 1;
    curr[j] = Math.min((prev[j] ?? 0) + 1, (curr[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
  }
  return curr;
}

/** Minimum single-edit distance between `a` and `b` (two-row DP, O(n) memory). */
export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prev: number[] = [];
  for (let j = 0; j <= n; j += 1) prev[j] = j;
  for (let i = 1; i <= m; i += 1) prev = nextRow(prev, i, a.charCodeAt(i - 1), b);
  return prev[n] ?? 0;
}
