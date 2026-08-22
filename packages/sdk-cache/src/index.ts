/**
 * `@theokit/sdk-cache` — semantic LLM response cache for `@theokit/sdk`.
 *
 * Extracted from `@theokit/sdk@1.7.0` as part of the SDK 2.0 package split
 * (Phase 3 / T3.1). Integrates with `Agent` via the Plugin protocol —
 * `cache.asPlugin()` returns a `Plugin` consumable by `Agent.create({ plugins })`.
 *
 * @packageDocumentation
 */

export { Cache } from "./cache.js";
export { createLexicalEmbedder } from "./lexical-embedder.js";
export type {
  CacheEmbedderRuntime,
  CacheEntry,
  CachePersistenceOptions,
  CacheSemanticOptions,
  CacheStats,
  CacheTTLConfig,
} from "./types/cache.js";
export { CacheInvalidTtlError } from "./types/cache.js";
