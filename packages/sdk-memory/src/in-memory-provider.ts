/**
 * `createInMemoryMarkdownProvider` — first concrete `MemoryProvider`
 * impl shipped in `@theokit/sdk-memory` (SDK 2.0 Phase 1 / T1.6).
 *
 * Goal: prove the contract works end-to-end with a real (non-no-op)
 * impl WITHOUT pulling LanceDB / embedding / circuit-breaker infrastructure.
 * That richer impl lands in subsequent iters.
 *
 * Semantics:
 *   - Stores recalled facts in a per-agent in-process Map.
 *   - `runActivePass()` returns the facts plus a `systemPromptAdditions`
 *     string that joins fact contents with newlines (so the LLM sees
 *     them in the system slot).
 *   - `buildTools()` surfaces a `memory_remember(content)` tool the LLM
 *     can call to persist a fact mid-conversation.
 *   - `dispose()` clears the handle's per-agent map (releases memory).
 *
 * @public
 */

import type {
  ActiveMemoryPassArgs,
  ActiveMemoryPassResult,
  CustomTool,
  MemoryAdapter,
  MemoryAdapterCapabilities,
  MemoryContext,
  MemoryFact,
  MemoryId,
  MemoryProvider,
  MemoryProviderHandle,
  MemoryProviderInitOptions,
  MemoryTurnMessage,
  SDKAgent,
} from "@theokit/sdk";

/** Adapter id prefix — namespaces minted MemoryIds so cross-adapter delete is safe (EC-B). */
const ADAPTER_ID = "in-memory-md";

/** Per-agent state holder. Stored on the handle via the opaque symbol slot. */
interface InMemoryHandleState {
  readonly facts: Map<string, MemoryFact>;
  readonly counter: { next: number };
}

const INTERNAL_STATE = Symbol("sdk-memory.in-memory.state");

function buildCapabilities(): MemoryAdapterCapabilities {
  return {
    history: false,
    sessions: false,
    tenancy: false,
    reasoning: false,
    toolSchemas: false,
    prefetch: false,
  };
}

function buildAdapter(state: InMemoryHandleState): MemoryAdapter {
  return {
    id: ADAPTER_ID,
    capabilities: buildCapabilities(),
    isAvailable(): boolean {
      return true;
    },
    async write(content: string | MemoryTurnMessage[], _ctx: MemoryContext): Promise<MemoryId> {
      const text = typeof content === "string" ? content : content.map((m) => m.content).join("\n");
      const id = `${ADAPTER_ID}:${state.counter.next++}` as MemoryId;
      state.facts.set(id, {
        id,
        content: text,
        createdAt: new Date().toISOString(),
      });
      return id;
    },
    async recall(_query: string, _ctx: MemoryContext, k?: number): Promise<MemoryFact[]> {
      // Naive recall — return everything (cap at k). Real impls in
      // subsequent iters add semantic similarity via embeddings.
      const all = Array.from(state.facts.values());
      const limit = k !== undefined && k >= 0 ? k : all.length;
      return all.slice(0, limit);
    },
    async delete(id: MemoryId): Promise<void> {
      if (!String(id).startsWith(`${ADAPTER_ID}:`)) {
        throw new Error(
          `MemoryAdapter.delete: id "${String(id)}" was not minted by adapter "${ADAPTER_ID}"`,
        );
      }
      state.facts.delete(id);
    },
  };
}

function buildMemoryRememberTool(state: InMemoryHandleState): CustomTool {
  return {
    name: "memory_remember",
    description:
      "Persist a short fact about the user/conversation to memory so it can be recalled in future turns. Pass a single concise sentence as `content`.",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "The fact to remember (one sentence)." },
      },
      required: ["content"],
      additionalProperties: false,
    },
    handler: async (input: Record<string, unknown>): Promise<string> => {
      const content = typeof input.content === "string" ? input.content : "";
      if (content.length === 0) {
        return JSON.stringify({ ok: false, error: "empty content" });
      }
      const id = `${ADAPTER_ID}:${state.counter.next++}` as MemoryId;
      state.facts.set(id, {
        id,
        content,
        createdAt: new Date().toISOString(),
      });
      return JSON.stringify({ ok: true, id });
    },
  };
}

/**
 * Build a fresh `MemoryProvider` whose facts live in-process. The
 * returned provider is independent — call `createInMemoryMarkdownProvider()`
 * per agent OR share across agents (each `init()` gets its own state).
 *
 * Options reserved for future versions (LanceDB path, embedding model, …).
 * Current impl accepts `MemoryProviderInitOptions.cwd` for forward-compat
 * but does NOT read from disk.
 */
export function createInMemoryMarkdownProvider(): MemoryProvider {
  return {
    async init(_opts: MemoryProviderInitOptions): Promise<MemoryProviderHandle> {
      const state: InMemoryHandleState = {
        facts: new Map(),
        counter: { next: 0 },
      };
      const adapter = buildAdapter(state);
      return {
        adapter,
        [INTERNAL_STATE]: state,
      };
    },
    buildTools(handle: MemoryProviderHandle, _agent: SDKAgent): ReadonlyArray<CustomTool> {
      const state = handle[INTERNAL_STATE] as InMemoryHandleState | undefined;
      if (state === undefined) return [];
      return [buildMemoryRememberTool(state)];
    },
    async runActivePass(
      handle: MemoryProviderHandle,
      _args: ActiveMemoryPassArgs,
    ): Promise<ActiveMemoryPassResult> {
      const state = handle[INTERNAL_STATE] as InMemoryHandleState | undefined;
      if (state === undefined) return { facts: [] };
      const facts = Array.from(state.facts.values());
      if (facts.length === 0) return { facts: [] };
      const systemPromptAdditions = [
        "Known facts about the user/session (recall):",
        ...facts.map((f) => `- ${f.content}`),
      ].join("\n");
      return { facts, systemPromptAdditions };
    },
    sync(_handle: MemoryProviderHandle): void {
      // No-op for the in-memory impl — facts are written synchronously to
      // the Map at handler-call time; nothing to re-index post-run. Future
      // LanceDB-backed impl will fire IndexManager.sync() here.
      return;
    },
    recordSessionSummary(): void {
      // No-op for the in-memory impl — session summaries are stateful
      // file writes; without a filesystem-backed store, there's nothing
      // to persist. Future LanceDB-backed impl writes the markdown to
      // `${cwd}/.theokit/sessions/${runId}.md` then triggers re-index.
      return;
    },
    dispose(handle: MemoryProviderHandle): void {
      const state = handle[INTERNAL_STATE] as InMemoryHandleState | undefined;
      if (state === undefined) return;
      state.facts.clear();
    },
  };
}
