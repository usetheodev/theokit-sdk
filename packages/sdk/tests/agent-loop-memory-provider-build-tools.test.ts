/**
 * `MemoryProvider.buildTools()` wiring tests (SDK 2.0 Phase 1 / T1.5.2).
 *
 * Mirrors the iter 15 BudgetTracker.track() wiring discipline: test the
 * BRANCH LOGIC the `initLoopContext` call site implements (collect
 * tools, append provider tools after memoryTools + customTools, swallow
 * provider-side throw). Pinning here guards against regressions when
 * the wiring is refactored.
 */

import type {
  ActiveMemoryPassArgs,
  ActiveMemoryPassResult,
  CustomTool,
  MemoryAdapter,
  MemoryProvider,
  MemoryProviderHandle,
  MemoryProviderInitOptions,
  SDKAgent,
} from "@theokit/sdk";
import { describe, expect, it, vi } from "vitest";

function makeStubAdapter(): MemoryAdapter {
  return {
    id: "spy",
    capabilities: {
      history: false,
      sessions: false,
      tenancy: false,
      reasoning: false,
      toolSchemas: false,
      prefetch: false,
    },
    isAvailable: () => true,
    write: async () => "spy:noop" as never,
    recall: async () => [],
    delete: async () => undefined,
  };
}

function buildSpyProvider(opts?: {
  buildToolsThrows?: boolean;
  providerTools?: ReadonlyArray<CustomTool>;
}) {
  const initSpy = vi.fn(
    async (_o: MemoryProviderInitOptions): Promise<MemoryProviderHandle> => ({
      adapter: makeStubAdapter(),
    }),
  );
  const buildToolsSpy = vi.fn(
    (_h: MemoryProviderHandle, _a: SDKAgent): ReadonlyArray<CustomTool> => {
      if (opts?.buildToolsThrows) throw new Error("buildTools blew");
      return opts?.providerTools ?? [];
    },
  );
  const runActivePassSpy = vi.fn(
    async (_h: MemoryProviderHandle, _a: ActiveMemoryPassArgs): Promise<ActiveMemoryPassResult> => ({
      facts: [],
    }),
  );
  const disposeSpy = vi.fn((_h: MemoryProviderHandle): void => undefined);
  const provider: MemoryProvider = {
    init: initSpy,
    buildTools: buildToolsSpy,
    runActivePass: runActivePassSpy,
    dispose: disposeSpy,
  };
  return { provider, initSpy, buildToolsSpy, runActivePassSpy, disposeSpy };
}

/**
 * Mirror of the wiring at `loop.ts initLoopContext` ~ after the
 * customTools loop. APPENDS provider tools to a base tools array.
 * Provider throw → tools array unchanged (swallow).
 */
function performBuildTools<T extends { name: string }>(
  provider: MemoryProvider | undefined,
  handle: MemoryProviderHandle | undefined,
  agent: SDKAgent,
  baseTools: T[],
): Array<T | { name: string; description: string; inputSchema: Record<string, unknown> }> {
  const tools: Array<T | { name: string; description: string; inputSchema: Record<string, unknown> }> = [
    ...baseTools,
  ];
  if (provider === undefined || handle === undefined) return tools;
  let providerTools: ReadonlyArray<CustomTool> = [];
  try {
    providerTools = provider.buildTools(handle, agent);
  } catch {
    providerTools = [];
  }
  for (const t of providerTools) {
    tools.push({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    });
  }
  return tools;
}

const STUB_AGENT: SDKAgent = { agentId: "a", model: undefined } as SDKAgent;

describe("MemoryProvider buildTools() wiring (Phase 1 / T1.5.2)", () => {
  it("test_no_provider_means_no_tools_appended", () => {
    const tools = performBuildTools(undefined, undefined, STUB_AGENT, [
      { name: "shell" } as { name: string },
    ]);
    expect(tools.length).toBe(1);
    expect(tools[0]?.name).toBe("shell");
  });

  it("test_provider_with_no_tools_appends_nothing", async () => {
    const { provider, buildToolsSpy } = buildSpyProvider();
    const handle = await provider.init({ cwd: "/tmp" });
    const tools = performBuildTools(provider, handle, STUB_AGENT, [{ name: "shell" }]);
    expect(buildToolsSpy).toHaveBeenCalledTimes(1);
    expect(tools.length).toBe(1);
  });

  it("test_provider_tools_appended_after_base_tools", async () => {
    const providerTools: CustomTool[] = [
      {
        name: "memory_search",
        description: "Search memory by query.",
        inputSchema: { type: "object", properties: { q: { type: "string" } } },
        handler: async () => "{}",
      },
      {
        name: "memory_get",
        description: "Fetch a memory by id.",
        inputSchema: { type: "object" },
        handler: async () => "{}",
      },
    ];
    const { provider, buildToolsSpy } = buildSpyProvider({ providerTools });
    const handle = await provider.init({ cwd: "/tmp" });
    const tools = performBuildTools(provider, handle, STUB_AGENT, [
      { name: "shell" },
      { name: "mcp_get" },
    ]);
    expect(buildToolsSpy).toHaveBeenCalledTimes(1);
    expect(buildToolsSpy).toHaveBeenCalledWith(handle, STUB_AGENT);
    expect(tools.map((t) => t.name)).toEqual(["shell", "mcp_get", "memory_search", "memory_get"]);
  });

  it("test_buildTools_throw_swallowed_tools_unchanged", async () => {
    const { provider, buildToolsSpy } = buildSpyProvider({ buildToolsThrows: true });
    const handle = await provider.init({ cwd: "/tmp" });
    const tools = performBuildTools(provider, handle, STUB_AGENT, [{ name: "shell" }]);
    expect(buildToolsSpy).toHaveBeenCalledTimes(1);
    expect(tools.length).toBe(1);
    expect(tools[0]?.name).toBe("shell");
  });

  it("test_buildTools_not_called_when_init_failed", () => {
    const { provider, buildToolsSpy } = buildSpyProvider();
    // Simulate: handle is undefined (init threw earlier).
    const tools = performBuildTools(provider, undefined, STUB_AGENT, [{ name: "shell" }]);
    expect(buildToolsSpy).not.toHaveBeenCalled();
    expect(tools.length).toBe(1);
  });

  it("test_buildTools_receives_handle_and_agent_refs", async () => {
    const { provider, buildToolsSpy } = buildSpyProvider();
    const handle = await provider.init({ cwd: "/tmp" });
    const agent: SDKAgent = { agentId: "my-agent", model: undefined } as SDKAgent;
    performBuildTools(provider, handle, agent, []);
    expect(buildToolsSpy).toHaveBeenCalledWith(handle, agent);
    // Identity preserved (no defensive clone).
    expect(buildToolsSpy.mock.calls[0]?.[0]).toBe(handle);
    expect(buildToolsSpy.mock.calls[0]?.[1]).toBe(agent);
  });
});
