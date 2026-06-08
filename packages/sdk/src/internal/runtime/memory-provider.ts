/**
 * `MemoryProvider` — kernel-facing port for the memory subsystem
 * (SDK 2.0 Phase 1 / T1.1 — Hexagonal Architecture / Ports & Adapters,
 * SOLID Dependency Inversion).
 *
 * The agent loop kernel depends on THIS CONTRACT — not on the concrete
 * `internal/memory/*` modules. Default adapter ships with `@theokit/sdk`
 * (no-op for back-compat); rich impl ships in `@theokit/sdk-memory`.
 * Consumers opt-in via `Agent.create({ memoryProvider: ... })` (wiring
 * lands in subsequent iteration).
 *
 * Design rationale (ADR-001 + ADR-003 in
 * `sdk-2-0-phase-1-2-adr.md`):
 *   - Memory subsystem is deeply integrated with the agent loop (active
 *     memory pass, LLM tool injection, lifecycle ownership) — cannot
 *     extract via plugin-protocol alone like Cache / Handoff.
 *   - Interface inversion is the canonical FAANG-style answer: the kernel
 *     defines what it NEEDS; impls satisfy the contract; package boundary
 *     is the seam.
 *   - Mirrors the `BudgetTracker` interface inversion (iter 10-16): same
 *     pattern, different subsystem.
 *
 * Layered model (mirrors Budget):
 *   - `MemoryAdapter` (existing in `types/memory-adapter.ts`) — LOW-LEVEL
 *     data port: write / recall / delete primitives.
 *   - `MemoryProvider` (THIS FILE) — HIGH-LEVEL lifecycle port: init,
 *     tool factories, active memory pass, embedding runtime selection.
 *
 * @public — surface-level interface; impls are internal-but-replaceable.
 */

import type { CustomTool, SDKAgent } from "../../types/agent.js";
import type { MemoryAdapter, MemoryFact } from "../../types/memory-adapter.js";

/** Result of `MemoryProvider.runActivePass(...)` — what the kernel injects into the LLM call. */
export interface ActiveMemoryPassResult {
  /** Compressed memory facts to seed the LLM's context window for this turn. */
  readonly facts: ReadonlyArray<MemoryFact>;
  /** Optional system-prompt enrichment derived from the recalled facts. */
  readonly systemPromptAdditions?: string;
  /** Whether the active-memory circuit breaker tripped (degraded mode). */
  readonly breakerTripped?: boolean;
}

/** Arguments for `MemoryProvider.runActivePass(...)`. */
export interface ActiveMemoryPassArgs {
  /** The current user message — used as the recall query. */
  readonly userMessage: string;
  /** Conversation history (most recent first). */
  readonly history: ReadonlyArray<{ role: "user" | "assistant"; content: string }>;
  /** Agent identity for scope. */
  readonly agentId: string;
}

/** Options for `MemoryProvider.init(...)`. */
export interface MemoryProviderInitOptions {
  /** Workspace cwd where on-disk artefacts live (`.theokit/memory/...`). */
  readonly cwd: string;
  /** Embedding-provider id (`"openai" | "ollama" | ...`); when omitted the impl picks a default. */
  readonly embeddingProviderId?: string;
}

/**
 * Opaque handle returned by `init()`. Carried back into other methods so
 * the impl can stash per-agent state (index, breaker, cache, …) without
 * exposing it to the kernel.
 */
export interface MemoryProviderHandle {
  /** Adapter interface for direct read/write — matches existing `MemoryAdapter` shape. */
  readonly adapter: MemoryAdapter;
  /** Implementation-defined opaque field (private state pointer / index handle). */
  readonly [implState: symbol]: unknown;
}

/**
 * The kernel-facing contract. Implementations live OUTSIDE the agent loop
 * (in `@theokit/sdk-memory` after Phase 1; in `internal/memory/` until then).
 *
 * Implementations MUST be:
 *   - **Lazy** — `init()` may be called once per agent; subsequent calls
 *     return the same handle (impl decides via cache). Heavy work
 *     (loading the index, opening SQLite) deferred until first use.
 *   - **Non-throwing on the hot path** — `runActivePass()` returns an
 *     empty `facts: []` on degradation rather than throwing. Errors
 *     surface via the breakerTripped flag + telemetry.
 */
export interface MemoryProvider {
  /** Construct or fetch the per-agent handle. Lazy + idempotent. */
  init(opts: MemoryProviderInitOptions): Promise<MemoryProviderHandle>;
  /** Build the LLM-facing tool catalog (memory_search, memory_get, …). */
  buildTools(handle: MemoryProviderHandle, agent: SDKAgent): ReadonlyArray<CustomTool>;
  /** Run the active-memory pre-LLM pass — recall + compress + format. */
  runActivePass(
    handle: MemoryProviderHandle,
    args: ActiveMemoryPassArgs,
  ): Promise<ActiveMemoryPassResult>;
  /**
   * Optional post-run hook (SDK 2.0 Phase 1 physical Stage 1 — iter 19).
   * Called by the agent loop AFTER a successful send so the impl can
   * incorporate the session summary into its index (e.g., re-index the
   * `sessions` corpus so the next recall sees it).
   *
   * Fire-and-forget at the call site; impl MUST be idempotent +
   * non-throwing. Optional so existing impls (createNoopMemoryProvider,
   * sdk-memory@0.1.0) keep working without modification.
   *
   * Mirrors the role of `LocalAgentMemory.syncIfReady()` in sdk-core's
   * legacy memory path — exposing it via the port is the seam that
   * unblocks moving LocalAgentMemory's logic out to sdk-memory.
   */
  sync?(handle: MemoryProviderHandle): Promise<void> | void;
  /** Release the handle (close index, flush caches). Idempotent + non-throwing. */
  dispose(handle: MemoryProviderHandle): Promise<void> | void;
}
