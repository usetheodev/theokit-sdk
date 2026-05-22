/**
 * Cosine distance between two equal-length vectors.
 *
 * Returns `1 - cos(a, b)`. Range:
 *   - 0.0 = identical direction
 *   - 1.0 = orthogonal
 *   - 2.0 = opposite (rare in normalized embeddings)
 *
 * Throws on dim mismatch. (Callers MUST filter by dim before calling
 * — EC-2 absorbed at the store level.)
 *
 * @internal
 */

export function cosineDistance(a: ReadonlyArray<number>, b: ReadonlyArray<number>): number {
  if (a.length !== b.length) {
    throw new Error(`cosineDistance: dim mismatch (${a.length} vs ${b.length})`);
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const av = a[i]!;
    const bv = b[i]!;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (normA === 0 || normB === 0) return 1.0;
  return 1 - dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
