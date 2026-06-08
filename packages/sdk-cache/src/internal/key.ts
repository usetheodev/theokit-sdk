/**
 * Composite cache key (ADR D253).
 *
 * Format: `${namespace}:${embedderId}:${modelId}:${hash(normalizedPrompt)}`.
 * Normalizes whitespace + lowercases. Hash = first 16 hex chars of SHA-256.
 *
 * @internal
 */

import { createHash } from "node:crypto";

export interface CacheKeyParams {
  namespace: string;
  embedderId: string;
  modelId: string;
  prompt: string;
}

export function computeCacheKey(p: CacheKeyParams): string {
  const normalized = p.prompt.trim().replace(/\s+/g, " ").toLowerCase();
  const hash = createHash("sha256").update(normalized).digest("hex").slice(0, 16);
  return `${p.namespace}:${p.embedderId}:${p.modelId}:${hash}`;
}
