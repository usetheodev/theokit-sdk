/**
 * `createLocalAgentMemoryProvider` — bridges the legacy LocalAgentMemory
 * rich impl (sdk-core's internal/memory/* subsystem) to the
 * MemoryProvider port (SDK 2.0 Phase 1 physical Stage 2a — iter 19+).
 *
 * Goal: ONE memory path inside the kernel. Today there are TWO:
 *   1. Legacy via `LocalAgentMemory` (when consumer didn't pass memoryProvider)
 *   2. Port via `MemoryProvider` (when consumer passed memoryProvider in T1.3)
 *
 * This adapter wraps path 1 as a MemoryProvider, so the kernel can use
 * the port uniformly. Stage 2b will refactor LocalAgent.send() to use
 * the port + this adapter as default. Stage 3 will move the internal/
 * memory/* sources to sdk-memory + ship a richer LanceDB-backed
 * provider replacing this adapter.
 *
 * Why a separate file (not modifying LocalAgentMemory):
 *   - Preserves LocalAgentMemory's existing public API for callers that
 *     haven't migrated to the port yet.
 *   - Adapter pattern: the rich logic stays where it is; the adapter
 *     translates between LocalAgentMemory's signature and the port's.
 *   - Allows incremental migration: kernel call sites move one at a
 *     time from `memoryGlue.X()` direct calls to `provider.X(handle)`
 *     calls.
 *
 * @internal — sdk-core's bridging glue. Replaced by sdk-memory rich impl
 * in Stage 3.
 */

import type { AgentOptions, CustomTool, SDKAgent } from "../../types/agent.js";
import { writeSessionSummary } from "../memory/storage/session-summary-writer.js";
import type {
  ActiveMemoryPassArgs,
  ActiveMemoryPassResult,
  MemoryProvider,
  MemoryProviderHandle,
  MemoryProviderInitOptions,
  RecordSessionSummaryArgs,
} from "../runtime/memory-glue/memory-provider.js";
import type { TelemetryHandle } from "../telemetry/tracer.js";
import { LocalAgentMemory } from "./local-agent-memory.js";

const INTERNAL_LAM_KEY = Symbol("sdk-core.local-agent-memory-provider.glue");

interface AdapterState {
  glue: LocalAgentMemory;
  telemetry?: TelemetryHandle;
}

/**
 * Options for `createLocalAgentMemoryProvider`. Mirrors what
 * `LocalAgentMemory`'s constructor needs.
 */
export interface LocalAgentMemoryProviderOptions {
  /** AgentOptions slice — required for memory subsystem config (cfg.memory). */
  readonly agentOptions: AgentOptions;
  /** Workspace cwd — used for `.theokit/memory/` paths. */
  readonly workspaceCwd: string;
  /** Agent id — required for per-agent cache + telemetry. */
  readonly agentId: string;
  /** Telemetry handle (optional) — forwarded to active-memory recall. */
  readonly telemetry?: TelemetryHandle;
}

/**
 * Build a `MemoryProvider` whose lifecycle methods delegate to an
 * underlying `LocalAgentMemory` instance.
 *
 * Mapping:
 *   - `init()`        → constructs LocalAgentMemory + warms tool cache via ensureTools()
 *   - `buildTools()`  → wraps ensureTools() result, renaming `execute` to `handler`
 *   - `runActivePass()` → calls runActiveMemoryIfEnabled() with synthesized args;
 *                         returns the summary as `systemPromptAdditions`
 *   - `sync()`        → calls syncIfReady()
 *   - `dispose()`     → no-op (LocalAgentMemory's caches are per-agent + GC'd
 *                       when the agent is GC'd)
 */
export function createLocalAgentMemoryProvider(
  opts: LocalAgentMemoryProviderOptions,
): MemoryProvider {
  return {
    async init(_opts: MemoryProviderInitOptions): Promise<MemoryProviderHandle> {
      const glue = new LocalAgentMemory(opts.agentOptions, opts.workspaceCwd, opts.agentId);
      // Warm the tools cache so subsequent buildTools() is sync-friendly.
      // ensureTools() returns undefined when memory is disabled — that's fine.
      await glue.ensureTools();
      const state: AdapterState = {
        glue,
        ...(opts.telemetry !== undefined ? { telemetry: opts.telemetry } : {}),
      };
      return {
        // The adapter doesn't ship a real MemoryAdapter today — kernel
        // callers reach memory via the glue methods, not the adapter.
        // Future iters can hydrate this from the IndexManager if a
        // direct read/write surface is needed.
        adapter: {
          id: "local-agent-memory",
          capabilities: {
            history: false,
            sessions: true,
            tenancy: false,
            reasoning: false,
            toolSchemas: true,
            prefetch: false,
          },
          isAvailable: () => true,
          write: async () => "local-agent-memory:noop" as never,
          recall: async () => [],
          delete: async () => undefined,
        },
        [INTERNAL_LAM_KEY]: state,
      };
    },
    buildTools(handle: MemoryProviderHandle, _agent: SDKAgent): ReadonlyArray<CustomTool> {
      const state = handle[INTERNAL_LAM_KEY] as AdapterState | undefined;
      if (state === undefined) return [];
      // Read from the sync `getCachedTools()` view (Stage 2b — iter 19+
      // — `LocalAgentMemory` added this sync accessor so the adapter
      // can surface the same memory_search + memory_get tools the
      // legacy path would). init() already awaited ensureTools() to
      // warm the cache; this is the readout.
      const cached = state.glue.getCachedTools();
      if (cached === undefined || cached.length === 0) return [];
      // Translate MemoryToolSpec (`execute`) → CustomTool (`handler`).
      // Shape compatible (name + description + inputSchema match);
      // only the handler-function key renames.
      return cached.map((memTool) => ({
        name: memTool.name,
        description: memTool.description,
        inputSchema: memTool.inputSchema,
        handler: memTool.execute,
      }));
    },
    async runActivePass(
      handle: MemoryProviderHandle,
      args: ActiveMemoryPassArgs,
    ): Promise<ActiveMemoryPassResult> {
      const state = handle[INTERNAL_LAM_KEY] as AdapterState | undefined;
      if (state === undefined) return { facts: [] };
      const priorMessages = args.history.map((m) => ({ role: m.role, text: m.content }));
      const summary = await state.glue.runActiveMemoryIfEnabled(
        args.userMessage,
        priorMessages,
        state.telemetry,
      );
      if (summary === undefined || summary.length === 0) return { facts: [] };
      return { facts: [], systemPromptAdditions: summary };
    },
    async recordSessionSummary(args: RecordSessionSummaryArgs): Promise<void> {
      // Stateless: delegate to the legacy `writeSessionSummary` directly.
      // Args are passthrough — same shape as the legacy `SessionSummaryInput`.
      await writeSessionSummary(args);
    },
    async sync(handle: MemoryProviderHandle): Promise<void> {
      const state = handle[INTERNAL_LAM_KEY] as AdapterState | undefined;
      if (state === undefined) return;
      await state.glue.syncIfReady();
    },
    dispose(_handle: MemoryProviderHandle): void {
      // LocalAgentMemory has no explicit disposal — caches are GC'd
      // when the agent reference drops. The state ref on the handle
      // is the only thing keeping the glue alive after this.
      return;
    },
  };
}
