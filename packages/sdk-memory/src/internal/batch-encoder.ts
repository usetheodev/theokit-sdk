/**
 * Batch encoding pipeline — embeds N texts in 1 API call with intra-batch dedup.
 *
 * Inspired by CrewAI's `encoding_flow.py` Stage 1-2: batch embed + cosine dedup.
 * Per ADR D1: new module alongside sync(), not a replacement.
 *
 * @internal
 */

import type { EmbeddingRuntime } from "./embedding-adapter.js";

interface RememberManyOptions {
  scope?: string;
  importance?: number;
  dedupThreshold?: number;
}

interface RememberManyResult {
  total: number;
  deduped: number;
  inserted: number;
}

interface KeptItem {
  text: string;
  vector: number[];
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0; // EC-3: zero vector guard
  return dot / denom;
}

function intraBatchDedup(texts: string[], vectors: number[][], threshold: number): KeptItem[] {
  const kept: KeptItem[] = [];
  for (let i = 0; i < texts.length; i++) {
    let isDuplicate = false;
    for (const k of kept) {
      if (cosineSimilarity(vectors[i]!, k.vector) >= threshold) {
        isDuplicate = true;
        break;
      }
    }
    if (!isDuplicate) {
      kept.push({ text: texts[i]!, vector: vectors[i]! });
    }
  }
  return kept;
}

export async function rememberMany(
  texts: string[],
  embedding: EmbeddingRuntime,
  opts: RememberManyOptions = {},
): Promise<{ result: RememberManyResult; items: KeptItem[] }> {
  if (texts.length === 0) {
    return { result: { total: 0, deduped: 0, inserted: 0 }, items: [] };
  }

  const vectors = await embedding.embed(texts);
  const threshold = opts.dedupThreshold ?? 0.95;
  const kept = intraBatchDedup(texts, vectors, threshold);

  return {
    result: {
      total: texts.length,
      deduped: texts.length - kept.length,
      inserted: kept.length,
    },
    items: kept,
  };
}

export { cosineSimilarity };
