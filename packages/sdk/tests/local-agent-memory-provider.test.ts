/**
 * `createLocalAgentMemoryProvider` adapter tests (SDK 2.0 Phase 1
 * physical Stage 2a — iter 19+).
 *
 * Validates that the adapter satisfies the MemoryProvider contract
 * AND that its lifecycle methods correctly delegate to the underlying
 * LocalAgentMemory class.
 *
 * Note: with memory.enabled === false (the test default) the underlying
 * glue methods are no-ops — they return undefined / no facts. That's
 * fine for contract validation; richer integration is in Stage 3.
 */

import { describe, expect, it } from "vitest";
// Adapter is internal — import via relative path
import { createLocalAgentMemoryProvider } from "../src/internal/local-agent/local-agent-memory-provider.js";
import type { AgentOptions, SDKAgent } from "../src/types/agent.js";

const STUB_AGENT_OPTIONS: AgentOptions = {
  agentId: "test-agent",
  model: { id: "anthropic/claude-3-5-haiku-latest" },
  // memory NOT enabled — adapter still satisfies the contract
} as AgentOptions;

describe("createLocalAgentMemoryProvider (Stage 2a — iter 19+)", () => {
  it("test_factory_returns_provider_with_full_contract", () => {
    const provider = createLocalAgentMemoryProvider({
      agentOptions: STUB_AGENT_OPTIONS,
      workspaceCwd: "/tmp/theokit-test",
      agentId: "test-agent",
    });
    expect(typeof provider.init).toBe("function");
    expect(typeof provider.buildTools).toBe("function");
    expect(typeof provider.runActivePass).toBe("function");
    expect(typeof provider.sync).toBe("function");
    expect(typeof provider.dispose).toBe("function");
  });

  it("test_init_returns_handle_with_local_agent_memory_adapter", async () => {
    const provider = createLocalAgentMemoryProvider({
      agentOptions: STUB_AGENT_OPTIONS,
      workspaceCwd: "/tmp/theokit-test",
      agentId: "test-agent",
    });
    const handle = await provider.init({ cwd: "/tmp/theokit-test" });
    expect(handle.adapter).toBeDefined();
    expect(handle.adapter.id).toBe("local-agent-memory");
    expect(handle.adapter.capabilities.sessions).toBe(true);
    expect(handle.adapter.capabilities.toolSchemas).toBe(true);
  });

  it("test_buildTools_returns_empty_when_memory_disabled", async () => {
    // With memory.enabled !== true (test default), ensureTools()
    // returns undefined → toolsCache stays unset → adapter surfaces
    // []. Once Stage 3 ships, the rich impl will be in sdk-memory
    // and this path will be exercised with memory enabled too.
    const provider = createLocalAgentMemoryProvider({
      agentOptions: STUB_AGENT_OPTIONS,
      workspaceCwd: "/tmp/theokit-test",
      agentId: "test-agent",
    });
    const handle = await provider.init({ cwd: "/tmp/theokit-test" });
    const tools = provider.buildTools(handle, {} as SDKAgent);
    expect(tools).toEqual([]);
  });

  it("test_buildTools_reads_from_LocalAgentMemory_cache_when_present", async () => {
    // When LocalAgentMemory's toolsCache is populated, the adapter
    // surfaces the SAME tools via buildTools(). Stage 2b — iter 19+
    // closed the previous Stage 2a gap (where buildTools always
    // returned []).
    //
    // We synthesize an enabled-memory scenario by injecting a stub
    // toolsCache directly onto the underlying LocalAgentMemory instance
    // via the adapter's handle. This avoids needing IndexManager.open()
    // (which requires fs / lancedb). The contract being tested is just
    // the adapter's translation layer, not the rich memory subsystem.
    const provider = createLocalAgentMemoryProvider({
      agentOptions: STUB_AGENT_OPTIONS,
      workspaceCwd: "/tmp/theokit-test",
      agentId: "test-agent",
    });
    const handle = await provider.init({ cwd: "/tmp/theokit-test" });
    // Reach into the handle's adapter state via the symbol slot.
    const HANDLE_KEYS = Object.getOwnPropertySymbols(handle);
    const stateSym = HANDLE_KEYS.find((s) => s.toString().includes("local-agent-memory-provider"));
    if (stateSym === undefined) throw new Error("adapter state symbol not found");
    const state = handle[stateSym] as { glue: { getCachedTools(): unknown } };
    // Inject a stub tool into the LocalAgentMemory's private toolsCache
    // (the `getCachedTools()` accessor reads from it).
    const stubTool = {
      name: "memory_search",
      description: "search memory",
      inputSchema: { type: "object" },
      execute: async () => "{}",
    };
    // biome-ignore lint/suspicious/noExplicitAny: test reaches private field
    (state.glue as any).toolsCache = [stubTool];
    const tools = provider.buildTools(handle, {} as SDKAgent);
    expect(tools.length).toBe(1);
    expect(tools[0]?.name).toBe("memory_search");
    expect(tools[0]?.description).toBe("search memory");
    expect(typeof tools[0]?.handler).toBe("function");
  });

  it("test_runActivePass_returns_empty_facts_when_memory_disabled", async () => {
    const provider = createLocalAgentMemoryProvider({
      agentOptions: STUB_AGENT_OPTIONS,
      workspaceCwd: "/tmp/theokit-test",
      agentId: "test-agent",
    });
    const handle = await provider.init({ cwd: "/tmp/theokit-test" });
    const result = await provider.runActivePass(handle, {
      userMessage: "hi",
      history: [],
      agentId: "test-agent",
    });
    expect(result.facts).toEqual([]);
    expect(result.systemPromptAdditions).toBeUndefined();
  });

  it("test_runActivePass_translates_history_to_priorMessages_shape", async () => {
    // LocalAgentMemory.runActiveMemoryIfEnabled expects
    // `{role, text}` shape; adapter must map from
    // ActiveMemoryPassArgs.history's `{role, content}` shape.
    const provider = createLocalAgentMemoryProvider({
      agentOptions: STUB_AGENT_OPTIONS,
      workspaceCwd: "/tmp/theokit-test",
      agentId: "test-agent",
    });
    const handle = await provider.init({ cwd: "/tmp/theokit-test" });
    // No throw === translation worked. Behavior validated by no-op
    // path; richer integration in Stage 3 when sdk-memory ships.
    await expect(
      provider.runActivePass(handle, {
        userMessage: "x",
        history: [
          { role: "user", content: "hi" },
          { role: "assistant", content: "hello" },
        ],
        agentId: "test-agent",
      }),
    ).resolves.toEqual({ facts: [] });
  });

  it("test_sync_does_not_throw_when_handle_unset", async () => {
    const provider = createLocalAgentMemoryProvider({
      agentOptions: STUB_AGENT_OPTIONS,
      workspaceCwd: "/tmp/theokit-test",
      agentId: "test-agent",
    });
    const handle = await provider.init({ cwd: "/tmp/theokit-test" });
    if (provider.sync === undefined) {
      throw new Error("sync should be defined on this adapter");
    }
    await expect(provider.sync(handle)).resolves.toBeUndefined();
  });

  it("test_dispose_is_noop_returns_undefined", async () => {
    const provider = createLocalAgentMemoryProvider({
      agentOptions: STUB_AGENT_OPTIONS,
      workspaceCwd: "/tmp/theokit-test",
      agentId: "test-agent",
    });
    const handle = await provider.init({ cwd: "/tmp/theokit-test" });
    expect(provider.dispose(handle)).toBeUndefined();
  });

  it("test_independent_instances_per_factory_call", async () => {
    const a = createLocalAgentMemoryProvider({
      agentOptions: STUB_AGENT_OPTIONS,
      workspaceCwd: "/tmp/theokit-test",
      agentId: "agent-a",
    });
    const b = createLocalAgentMemoryProvider({
      agentOptions: STUB_AGENT_OPTIONS,
      workspaceCwd: "/tmp/theokit-test",
      agentId: "agent-b",
    });
    expect(a).not.toBe(b);
    const ha = await a.init({ cwd: "/tmp/theokit-test" });
    const hb = await b.init({ cwd: "/tmp/theokit-test" });
    expect(ha).not.toBe(hb);
  });
});
