/**
 * Reference `MemoryProvider` impl — no-op fallback (SDK 2.0 Phase 1 /
 * T1.2 reference implementation, mirrors `createCounterBudgetTracker`).
 *
 * Every method is a degenerate identity:
 *   - `init()` returns a handle wrapping a no-op `MemoryAdapter`.
 *   - `buildTools()` returns `[]` (no memory tools surfaced to the LLM).
 *   - `runActivePass()` returns `{ facts: [] }` (no recall fires).
 *   - `dispose()` is a no-op.
 *
 * Why ship this:
 *   - Default safety net before `@theokit/sdk-memory` is installed.
 *   - Worked reference for authors of custom providers.
 *   - Enables `Agent.create({ memoryProvider: createNoopMemoryProvider() })`
 *     unit tests without pulling memory infrastructure.
 *
 * NOT a substitute for the existing `Memory` class — the legacy class
 * stays authoritative until the subsystem fully ports to providers
 * (Phase 1 / T1.6).
 *
 * @public — surface-level reference impl.
 */

import type {
  MemoryAdapter,
  MemoryAdapterCapabilities,
  MemoryContext,
  MemoryFact,
  MemoryId,
  MemoryTurnMessage,
} from "../../../types/memory-adapter.js";
import type {
  ActiveMemoryPassArgs,
  ActiveMemoryPassResult,
  MemoryProvider,
  MemoryProviderHandle,
  MemoryProviderInitOptions,
} from "./memory-provider.js";

/** Adapter-id used by the no-op MemoryAdapter — namespaced to avoid collision. */
const NOOP_ADAPTER_ID = "noop";

/** All-false capabilities — every optional feature gated off. */
const NOOP_CAPABILITIES: MemoryAdapterCapabilities = {
  history: false,
  sessions: false,
  tenancy: false,
  reasoning: false,
  toolSchemas: false,
  prefetch: false,
};

/** Build the no-op MemoryAdapter satisfying the public contract. */
function createNoopMemoryAdapter(): MemoryAdapter {
  return {
    id: NOOP_ADAPTER_ID,
    capabilities: NOOP_CAPABILITIES,
    isAvailable(): boolean {
      return true;
    },
    async write(_content: string | MemoryTurnMessage[], _ctx: MemoryContext): Promise<MemoryId> {
      // Return a deterministic noop id with the adapter-id prefix so
      // `extractRawId` cross-adapter safety check still works.
      return `${NOOP_ADAPTER_ID}:noop` as MemoryId;
    },
    async recall(_query: string, _ctx: MemoryContext, _k?: number): Promise<MemoryFact[]> {
      return [];
    },
    async delete(_id: MemoryId): Promise<void> {
      return;
    },
  };
}

/**
 * Build a fresh no-op MemoryProvider. The returned object is independent —
 * call `createNoopMemoryProvider()` per Agent instance. `init()` is
 * idempotent: subsequent calls return a NEW handle (no per-agent cache —
 * the no-op has no state worth caching).
 */
export function createNoopMemoryProvider(): MemoryProvider {
  return {
    async init(_opts: MemoryProviderInitOptions): Promise<MemoryProviderHandle> {
      return {
        adapter: createNoopMemoryAdapter(),
      };
    },
    buildTools(_handle: MemoryProviderHandle): readonly never[] {
      return [];
    },
    async runActivePass(
      _handle: MemoryProviderHandle,
      _args: ActiveMemoryPassArgs,
    ): Promise<ActiveMemoryPassResult> {
      return { facts: [] };
    },
    recordSessionSummary(): void {
      // No-op: the no-op provider doesn't persist anything. Defining the
      // method (vs leaving it undefined) is intentional — when consumers
      // wire the no-op explicitly, they OPT INTO the port path for the
      // session-summary write site too. Future rich impls override this
      // with real disk writes.
      return;
    },
    dispose(_handle: MemoryProviderHandle): void {
      return;
    },
  };
}

/** SE36 — `NoopMemoryProvider.create` replaces `createNoopMemoryProvider` (ADR 0015). @public */
export class NoopMemoryProvider {
  private constructor() {}
  static create(): MemoryProvider {
    return createNoopMemoryProvider();
  }
}
