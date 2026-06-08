/**
 * Equivalence smoke test for the `createLocalAgentMemoryProvider`
 * adapter (SDK 2.0 Phase 1 physical Stage 2b — iter 19+).
 *
 * Goal: prove that for the SAME `LocalAgentMemory` instance state, the
 * adapter's port methods produce the SAME outputs the legacy path
 * would consume. This is the equivalence proof needed before the
 * actual `LocalAgent.send()` refactor (Stage 2b proper) — it lets us
 * change the kernel call site confidently, knowing the port surfaces
 * the same memoryTools + summary as legacy.
 *
 * Strategy: synthesize a stub tools cache on a LocalAgentMemory
 * instance, then compare:
 *   - `glue.getCachedTools()` (legacy sync readout) vs.
 *     `adapter.buildTools(handle)` (port readout) — must surface the
 *     same tools (modulo `execute` → `handler` rename).
 *
 * Note: the deeper equivalence (active-memory summary, sync) is
 * harder to test without IndexManager + embeddings + filesystem.
 * The buildTools equivalence is the most-touched call path; sync +
 * runActivePass equivalence is asserted by unit tests in
 * `local-agent-memory-provider.test.ts`.
 */

import type { AgentOptions, SDKAgent } from "@theokit/sdk";
import { createLocalAgentMemoryProvider } from "../src/internal/runtime/local-agent-memory-provider.js";
import { LocalAgentMemory } from "../src/internal/runtime/local-agent-memory.js";
import { describe, expect, it } from "vitest";

const AGENT_OPTIONS: AgentOptions = {
  agentId: "equivalence-agent",
  model: { id: "anthropic/claude-3-5-haiku-latest" },
} as AgentOptions;

const STUB_TOOLS = [
  {
    name: "memory_search",
    description: "Search memory by semantic similarity.",
    inputSchema: { type: "object", properties: { query: { type: "string" } } },
    execute: async () => JSON.stringify({ results: [] }),
  },
  {
    name: "memory_get",
    description: "Fetch a memory by id.",
    inputSchema: { type: "object", properties: { id: { type: "string" } } },
    execute: async () => JSON.stringify({ memory: null }),
  },
];

describe("Adapter ↔ Legacy equivalence (Stage 2b — iter 19+)", () => {
  it("test_adapter_buildTools_matches_legacy_getCachedTools_shape", async () => {
    // Synthesize a populated LocalAgentMemory directly + provider that wraps it.
    const sharedGlue = new LocalAgentMemory(AGENT_OPTIONS, "/tmp/theokit-eq", "equivalence-agent");
    // Inject the tools into the private toolsCache field (we can't easily
    // run ensureTools() without IndexManager; the cache is what
    // ensureTools would populate).
    // biome-ignore lint/suspicious/noExplicitAny: test reaches private field
    (sharedGlue as any).toolsCache = STUB_TOOLS;

    const legacy = sharedGlue.getCachedTools();
    expect(legacy?.length).toBe(2);

    // Run the adapter with a FRESH glue but inject the same cache so
    // both sides see the same input. We can't easily replace the glue
    // inside the adapter without monkey-patching the factory; instead,
    // verify both readouts produce structurally equivalent tools for
    // the same MemoryToolSpec[] input.
    const adapter = createLocalAgentMemoryProvider({
      agentOptions: AGENT_OPTIONS,
      workspaceCwd: "/tmp/theokit-eq",
      agentId: "equivalence-agent",
    });
    const handle = await adapter.init({ cwd: "/tmp/theokit-eq" });
    const HANDLE_SYMS = Object.getOwnPropertySymbols(handle);
    const stateSym = HANDLE_SYMS.find((s) =>
      s.toString().includes("local-agent-memory-provider"),
    );
    if (stateSym === undefined) throw new Error("adapter state symbol not found");
    const state = handle[stateSym] as { glue: { toolsCache: typeof STUB_TOOLS } };
    state.glue.toolsCache = STUB_TOOLS;

    const adapted = adapter.buildTools(handle, {} as SDKAgent);
    expect(adapted.length).toBe(2);

    // Same name + description + inputSchema preserved across rename.
    for (let i = 0; i < legacy!.length; i++) {
      expect(adapted[i]?.name).toBe(legacy![i]?.name);
      expect(adapted[i]?.description).toBe(legacy![i]?.description);
      expect(adapted[i]?.inputSchema).toEqual(legacy![i]?.inputSchema);
    }
  });

  it("test_adapter_handler_invokes_underlying_execute", async () => {
    const adapter = createLocalAgentMemoryProvider({
      agentOptions: AGENT_OPTIONS,
      workspaceCwd: "/tmp/theokit-eq",
      agentId: "equivalence-agent",
    });
    const handle = await adapter.init({ cwd: "/tmp/theokit-eq" });
    const HANDLE_SYMS = Object.getOwnPropertySymbols(handle);
    const stateSym = HANDLE_SYMS.find((s) =>
      s.toString().includes("local-agent-memory-provider"),
    );
    if (stateSym === undefined) throw new Error("adapter state symbol not found");
    const state = handle[stateSym] as { glue: { toolsCache: typeof STUB_TOOLS } };
    // Use a tool whose execute is observable
    let executed = 0;
    const observableTool = {
      name: "memory_search",
      description: "x",
      inputSchema: { type: "object" },
      execute: async (input: Record<string, unknown>) => {
        executed++;
        return JSON.stringify(input);
      },
    };
    state.glue.toolsCache = [observableTool];
    const adapted = adapter.buildTools(handle, {} as SDKAgent);
    expect(adapted.length).toBe(1);

    // Calling the adapter's handler MUST invoke the underlying execute
    // and propagate the same arguments + return value (the shape
    // translation rename is the ONLY allowed difference).
    const result = await adapted[0]?.handler({ query: "what is foo?" });
    expect(executed).toBe(1);
    expect(result).toBe(JSON.stringify({ query: "what is foo?" }));
  });

  it("test_adapter_with_empty_cache_matches_legacy_empty_response", async () => {
    // When the glue's toolsCache is undefined (the test default),
    // both the legacy `glue.getCachedTools()` and the adapter's
    // `buildTools()` return effectively-empty responses.
    const glue = new LocalAgentMemory(AGENT_OPTIONS, "/tmp/theokit-eq", "equivalence-agent");
    expect(glue.getCachedTools()).toBeUndefined();

    const adapter = createLocalAgentMemoryProvider({
      agentOptions: AGENT_OPTIONS,
      workspaceCwd: "/tmp/theokit-eq",
      agentId: "equivalence-agent",
    });
    const handle = await adapter.init({ cwd: "/tmp/theokit-eq" });
    const tools = adapter.buildTools(handle, {} as SDKAgent);
    expect(tools).toEqual([]);
  });
});
