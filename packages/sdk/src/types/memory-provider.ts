/**
 * `MemoryProvider` — kernel-facing port for the memory subsystem
 * (SDK 2.0 Phase 1 / T1.1 — Hexagonal Architecture / Ports & Adapters,
 * SOLID Dependency Inversion).
 *
 * The agent loop kernel depends on THIS CONTRACT — not on the concrete
 * `internal/memory/*` modules. Default adapter ships with `@theokit/sdk`
 * (no-op for back-compat); rich impl ships in `@theokit/sdk-memory`.
 * Consumers opt-in via `Agent.create({ memoryProvider: ... })`.
 *
 * DIP-correct home (SE46): the port + companion contract types live in the
 * domain `types/` layer; the application-layer module
 * (`internal/runtime/memory/memory-provider.ts`) re-exports them for
 * back-compat while the concrete providers live under `internal/`.
 *
 * Layered model (mirrors Budget):
 *   - `MemoryAdapter` (in `types/memory-adapter.ts`) — LOW-LEVEL data port:
 *     write / recall / delete primitives.
 *   - `MemoryProvider` (THIS FILE) — HIGH-LEVEL lifecycle port: init,
 *     tool factories, active memory pass, embedding runtime selection.
 *
 * @public — surface-level interface; impls are internal-but-replaceable.
 */

import type { CustomTool } from "./agent-prims.js";
import type { MemoryAdapter, MemoryFact } from "./memory-adapter.js";
import type { SDKAgent } from "./sdk-agent.js";

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

/**
 * Arguments for `MemoryProvider.recordSessionSummary(...)`
 * (SDK 2.0 Phase 1 physical Stage 3 prep — iter 27).
 *
 * The "session summary" is the markdown that gets written to disk
 * after a finished run + indexed under `corpus="sessions"`. This
 * port method lets sdk-core's `post-run-lifecycle.ts` delegate the
 * write to the provider instead of importing
 * `internal/memory/storage/session-summary-writer.ts` directly.
 *
 * @public
 */
export interface RecordSessionSummaryArgs {
  /**
   * Workspace cwd where on-disk artefacts live. Included on the args
   * (not on a handle) because `recordSessionSummary` is STATELESS — it
   * runs AFTER `runAgentLoop`'s `dispose()` releases the per-run handle.
   * The kernel passes its own `workspaceCwd`; the impl uses it to
   * compute the markdown file path.
   */
  readonly cwd: string;
  /**
   * The memory root the kernel resolved for this agent, from `memory.directory` or the default.
   *
   * Supplied by the kernel, never constructed by an implementor — which is why it is required
   * rather than optional. An implementation that recomputed it from `cwd` would write the summary
   * into a different directory than the one the rest of the subsystem uses (#463).
   */
  readonly memoryRoot: MemoryRoot;
  /** Run id used as the filename key. */
  readonly runId: string;
  /** Agent identity for scope (foldering). */
  readonly agentId: string;
  /** Verbatim user message that started the run. */
  readonly userText: string;
  /** Final assistant text the run produced. */
  readonly assistantText: string;
  /** Final run status (only "finished" is recorded today). */
  readonly status: "finished" | "error" | "cancelled";
  /** Wall-clock ms at write time. */
  readonly at: number;
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
  /**
   * Optional session-summary write hook (SDK 2.0 Phase 1 physical
   * Stage 3 prep — iter 27, refined iter 28).
   *
   * Called by `post-run-lifecycle.ts` AFTER a finished run to persist
   * the run's session-summary markdown under `corpus="sessions"`. When
   * defined, the kernel delegates the write to the provider; when
   * undefined, post-run-lifecycle falls back to the direct
   * `writeSessionSummary` import (legacy path, until Stage 3 source
   * move drops that import entirely).
   *
   * STATELESS — does NOT take a `MemoryProviderHandle` because post-run-
   * lifecycle runs AFTER `runAgentLoop` disposed the per-run handle.
   * `cwd` lives on `args` instead. Impls that need per-agent state can
   * cache it via closure inside the provider factory.
   *
   * Impl MUST be non-throwing on the hot path. The kernel swallows
   * any throw + emits a stderr warning.
   *
   * Optional so existing impls (createNoopMemoryProvider,
   * createInMemoryMarkdownProvider) keep working without modification.
   */
  recordSessionSummary?(args: RecordSessionSummaryArgs): Promise<void> | void;
  /** Release the handle (close index, flush caches). Idempotent + non-throwing. */
  dispose(handle: MemoryProviderHandle): Promise<void> | void;
}

/**
 * A directory that has been RESOLVED as a memory root, distinguished from a bare `cwd`.
 *
 * Structural rather than a `unique symbol` brand: a `unique symbol` is identity-based and the d.ts
 * bundler inlines the declaration into each package that re-exports it, so `@theokit/sdk-memory`
 * ended up with a `MemoryRoot` its own compiler considered incompatible with the SDK's, on values
 * that were the same string. A structural tag refuses a bare `string` exactly as well and survives
 * the package boundary, which is where this type has to work.
 *
 * G7 / DIP — defined HERE, in the domain types layer, rather than in
 * `internal/memory/storage/memory-root.ts`. It was defined in the adapter and reached for from this
 * file, which made the port depend on the adapter for a field of its own argument type; the runtime
 * helpers (`resolveMemoryRoot`, `asMemoryRoot`) stay in the adapter and import it from here.
 *
 * @public
 */
export type MemoryRoot = string & { readonly __memoryRoot: "resolved" };
