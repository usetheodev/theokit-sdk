/**
 * Composite scoring — blends semantic, text, recency, and importance signals.
 *
 * Inspired by CrewAI's `unified_memory.py` composite scoring (lines 345-381).
 * Default weights: semantic 0.5, text 0.2, recency 0.2, importance 0.1.
 * Backward-compatible: old behavior reproduced with {recencyWeight:0, importanceWeight:0}.
 *
 * @internal
 */

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export interface CompositeScoreConfig {
  semanticWeight: number;
  textWeight: number;
  recencyWeight: number;
  importanceWeight: number;
  recencyHalfLifeMs: number;
}

export const DEFAULT_COMPOSITE_CONFIG: CompositeScoreConfig = {
  semanticWeight: 0.5,
  textWeight: 0.2,
  recencyWeight: 0.2,
  importanceWeight: 0.1,
  recencyHalfLifeMs: THIRTY_DAYS_MS,
};

export function compositeScore(
  vectorScore: number,
  textScore: number,
  createdAt: number | null,
  importance: number,
  config: CompositeScoreConfig = DEFAULT_COMPOSITE_CONFIG,
): number {
  const recency =
    createdAt != null ? 0.5 ** ((Date.now() - createdAt) / config.recencyHalfLifeMs) : 0.5;

  return (
    config.semanticWeight * vectorScore +
    config.textWeight * textScore +
    config.recencyWeight * recency +
    config.importanceWeight * importance
  );
}
