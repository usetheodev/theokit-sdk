// Public API surface for @theokit/sdk-memory (SDK 2.0 Phase 1 / T1.6).
//
// Concrete `MemoryProvider` impls consuming the kernel-facing port from
// `@theokit/sdk`. Today: an in-process markdown-backed impl. Next iters
// ship LanceDB + embeddings + circuit-breaker + active-memory cache.

export { createInMemoryMarkdownProvider } from "./in-memory-provider.js";
