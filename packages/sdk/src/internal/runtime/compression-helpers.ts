/**
 * Compression helpers (T2.3, ADR D92).
 *
 * Scaffold for future compression LLM integration:
 *   - `selectCompressionWindow` — splits messages into compress/preserve halves
 *   - `assertCompressionReduced` — 10% reduction floor to detect "compression placebo"
 *
 * The compression LLM call itself is out of scope for this plan (requires
 * an auxiliary-model ADR). These helpers are used by `Agent.send` when a
 * future iteration adds compression.
 *
 * @internal
 */

export interface CompressionWindow<M> {
  toCompress: M[];
  toPreserve: M[];
}

/**
 * Split `messages` into the half to compress (older) and the half to
 * preserve verbatim (recent). When `messages.length <= preserveLast`,
 * everything is preserved.
 *
 * @internal
 */
export function selectCompressionWindow<M>(
  messages: readonly M[],
  preserveLast = 6,
): CompressionWindow<M> {
  if (messages.length <= preserveLast) {
    return { toCompress: [], toPreserve: [...messages] };
  }
  return {
    toCompress: messages.slice(0, -preserveLast),
    toPreserve: messages.slice(-preserveLast),
  };
}

export interface CompressionCheck {
  reduced: boolean;
  reductionPct: number;
  reason?: string;
}

/**
 * Check that compression actually reduced token count by at least `minPct`
 * (default 10%). Returns `{ reduced: false }` for spirals-in-formation
 * (compression LLM outputs that grow or barely shrink).
 *
 * @internal
 */
export function assertCompressionReduced(
  before: number,
  after: number,
  minPct = 10,
): CompressionCheck {
  if (before <= 0) {
    return { reduced: false, reductionPct: 0, reason: "before count was zero" };
  }
  const reductionPct = ((before - after) / before) * 100;
  if (reductionPct >= minPct) {
    return { reduced: true, reductionPct };
  }
  return {
    reduced: false,
    reductionPct,
    reason: `compression reduced ${reductionPct.toFixed(1)}% (< ${minPct}% min). Spiral likely.`,
  };
}
