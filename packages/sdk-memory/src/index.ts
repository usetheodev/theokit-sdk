// Public API surface for @theokit/sdk-memory (SDK 2.0 Phase 1 / T1.6).
//
// Concrete `MemoryProvider` impls consuming the kernel-facing port from
// `@theokit/sdk`. Today: an in-process markdown-backed impl. Next iters
// ship LanceDB + embeddings + active-memory cache.

export { createInMemoryMarkdownProvider } from "./in-memory-provider.js";

// Iter 44: first Stage 3 file move — CircuitBreaker copied from sdk-core's
// internal/memory/circuit-breaker.ts. sdk-core retains its copy for v1.x
// active-memory back-compat; sdk-memory's canonical copy is what future
// rich providers (LanceDB-backed) will consume. Hybrid dual-copy mirrors
// Phase 2 physical Stage 1 (sdk-budget) pattern.
export * from "./internal/circuit-breaker.js";

// Iter 45: second Stage 3 file move — embedding-adapter types (61 LOC,
// pure type-only file). Defines the contract that provider adapters
// (openai-embedding, ollama-embedding, etc.) implement.
// `MemoryEmbeddingProviderAdapter` + `CreateAdapterOptions` +
// `EmbeddingRuntime` + `EmbeddingRuntimeStats` + `EmbeddingCache`.
export * from "./internal/embedding-adapter.js";

// Iter 46: third Stage 3 file move — LruEmbeddingCache (36 LOC).
// Concrete bounded-LRU impl of `EmbeddingCache` from iter 45's
// embedding-adapter types. KEPT INTERNAL — not re-exported from the
// public barrel because no Stage 1 surface consumes it yet. Lives in
// sdk-memory's internal/ so future rich providers (LanceDB-backed)
// can import it as a sibling. Rollup-plugin-dts treeshake limitation
// + lack of public consumer = internal-only. Will be promoted to
// public if/when a consumer surface needs it.

// Iter 47: fourth Stage 3 file move — index-manager-contract types
// (75 LOC, pure type-only). Defines `MemorySearchHit`, `IndexStatus`,
// `SearchOptions`, `MemoryBackend`, `OpenIndexOptions` — the contract
// every IndexManager impl (sqlite-vec, lance, future ANN backends)
// satisfies. Imports only `EmbeddingRuntime` from iter 45's
// embedding-adapter.
export * from "./internal/index-manager-contract.js";
