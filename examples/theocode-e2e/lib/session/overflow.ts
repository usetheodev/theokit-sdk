const DEFAULT_BUFFER = 20_000;

/**
 * Returns true when totalTokens reaches or exceeds the usable
 * portion of the context window (contextWindow - buffer).
 *
 * Returns false when contextWindow <= 0 (unknown model).
 */
export function isOverflow(totalTokens: number, contextWindow: number, buffer?: number): boolean {
  const buf = buffer ?? DEFAULT_BUFFER;
  if (contextWindow <= 0) return false;
  return totalTokens >= contextWindow - buf;
}

/**
 * Returns the number of tokens available after reserving the buffer.
 * Never returns a negative value.
 */
export function usableTokens(contextWindow: number, buffer?: number): number {
  const buf = buffer ?? DEFAULT_BUFFER;
  return Math.max(0, contextWindow - buf);
}
