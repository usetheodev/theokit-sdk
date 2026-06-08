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
