/**
 * Built-in deterministic lexical embedder for `@theokit/sdk-cache` (RADAR #92.e).
 *
 * `Cache.semantic` requires a `CacheEmbedderRuntime` (no autoselect — it avoids
 * surprise LLM-embedding API calls). This supplies a REAL, deterministic,
 * zero-dependency embedding: a token-hash frequency vector, L2-normalized. It is
 * NOT a stub/fake — identical text yields identical vectors (exact cache hits)
 * and lexically similar text yields nearby vectors (cosine-similar hits). It
 * carries no semantic understanding (that needs an LLM embedder), which is the
 * honest trade-off: the cache's value here is exact-repeat + lexical dedup, with
 * no API cost.
 *
 * Promoted from theocode's `server/lib/cache-embedder.ts`.
 *
 * @public
 */

import type { CacheEmbedderRuntime } from "./types/cache.js";

export function createLexicalEmbedder(dimension = 256): CacheEmbedderRuntime {
  return {
    id: `theokit-lexical-v1-d${dimension}`,
    model: "theokit-lexical-hash",
    dimension,
    async embed(texts: ReadonlyArray<string>): Promise<number[][]> {
      return texts.map((text) => {
        const vec = new Array<number>(dimension).fill(0);
        for (const tok of text.toLowerCase().split(/\s+/).filter(Boolean)) {
          // FNV-ish rolling hash → bucket; deterministic across runs/processes.
          let h = 0;
          for (let i = 0; i < tok.length; i += 1) h = (h * 31 + tok.charCodeAt(i)) | 0;
          const idx = Math.abs(h) % dimension;
          vec[idx] = (vec[idx] ?? 0) + 1;
        }
        // L2-normalize so cosine distance is well-defined; an empty/whitespace
        // text stays the zero vector (the cache treats it as a non-match).
        const magnitude = Math.sqrt(vec.reduce((s, x) => s + x * x, 0)) || 1;
        return vec.map((x) => x / magnitude);
      });
    },
  };
}
