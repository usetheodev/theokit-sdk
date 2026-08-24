/**
 * End-to-end integration of `MemoryProvider` port through `runAgentLoop`
 * with a stub LLM (SDK 2.0 Phase 1 / iter 24).
 *
 * Drives the real `runAgentLoop` orchestrator with:
 *   - a stub LLM (deterministic single-turn response, no real network);
 *   - a spy `MemoryProvider` whose buildTools surfaces a real tool, and
 *     whose runActivePass emits a `systemPromptAdditions` value;
 *   - the iter 18 T1.5.* port wiring fires inside the loop.
 *
 * Asserts that:
 *   1. Provider lifecycle methods fire in canonical order (proven
 *      separately in `agent-loop-memory-provider-ordering.test.ts`,
 *      but verified again here with the REAL agent-loop, not a mirror).
 *   2. The LLM request includes the provider's tools in its `tools`
 *      catalog (proves `buildTools()` output reaches the LLM).
 *   3. The LLM request's `system` parameter includes the provider's
 *      `systemPromptAdditions` (proves `runActivePass()` output reaches
 *      the LLM via `resolveSystemPromptWithMemoryAdditions`).
 *   4. `dispose` fires even on a normal-finish path (not just error).
 */

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, onTestFinished } from "vitest";
import { runAgentLoop } from "../src/internal/agent-loop/loop.js";
import type { LlmClient, LlmEvent, LlmFinish, LlmRequest } from "../src/internal/llm/types.js";
import { HooksExecutor } from "../src/internal/runtime/hooks/hooks-executor.js";
import type {
  ActiveMemoryPassArgs,
  ActiveMemoryPassResult,
  MemoryProvider,
  MemoryProviderHandle,
  MemoryProviderInitOptions,
} from "../src/internal/runtime/memory/memory-provider.js";
import type { CustomTool, SDKAgent } from "../src/types/agent.js";
import type { MemoryAdapter } from "../src/types/memory-adapter.js";
import { removeTempDirRobust } from "./helpers/temp-workspace.js";

/** Stub LLM that records every request and returns a deterministic final turn. */
function buildRecordingStubClient(): { client: LlmClient; requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  const client: LlmClient = {
    name: "stub",
    async *stream(
      request: LlmRequest,
      _signal: AbortSignal,
    ): AsyncGenerator<LlmEvent, LlmFinish, void> {
      requests.push(request);
      yield { type: "text_delta", text: "ok" };
      return { stopReason: "end_turn", text: "ok", toolCalls: [] };
    },
  };
  return { client, requests };
}

/** MemoryAdapter that satisfies the public contract. */
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

describe("MemoryProvider full integration with runAgentLoop (iter 24)", () => {
  let cwd: string | undefined;
  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "theokit-mem-prov-"));
    const __cwdCleanup1 = cwd;
    onTestFinished(async () => {
      await removeTempDirRobust(__cwdCleanup1);
    });
  });
  afterEach(() => {
    cwd = undefined;
  });

  it("test_full_lifecycle_chain_fires_against_real_runAgentLoop", async () => {
    if (cwd === undefined) throw new Error("missing workspace");

    const calls: string[] = [];
    const memoryTool: CustomTool = {
      name: "memory_search",
      description: "Search memory by query.",
      inputSchema: { type: "object", properties: { q: { type: "string" } } },
      handler: async () => JSON.stringify({ results: [] }),
    };

    const provider: MemoryProvider = {
      async init(_o: MemoryProviderInitOptions): Promise<MemoryProviderHandle> {
        calls.push("init");
        return { adapter: makeStubAdapter() };
      },
      buildTools(_h: MemoryProviderHandle, _a: SDKAgent) {
        calls.push("buildTools");
        return [memoryTool];
      },
      async runActivePass(
        _h: MemoryProviderHandle,
        _a: ActiveMemoryPassArgs,
      ): Promise<ActiveMemoryPassResult> {
        calls.push("runActivePass");
        return {
          facts: [],
          systemPromptAdditions: "Known facts: user prefers TypeScript.",
        };
      },
      async sync(_h: MemoryProviderHandle): Promise<void> {
        calls.push("sync");
      },
      dispose(_h: MemoryProviderHandle): void {
        calls.push("dispose");
      },
    };

    const { client, requests } = buildRecordingStubClient();
    const hooks = new HooksExecutor(cwd);
    await hooks.initialize(false);

    const result = await runAgentLoop({
      agentId: "integration-agent",
      runId: "run-integration",
      model: { id: "stub-model" },
      userMessage: "test message",
      systemPrompt: "You are a helpful bot.",
      llm: client,
      mcp: new Map(),
      hooks,
      shellCwd: cwd,
      shellSandbox: false,
      memoryProvider: provider,
    });

    // Assertion 1: full lifecycle ordering fires against the REAL loop.
    expect(calls).toEqual(["init", "buildTools", "runActivePass", "sync", "dispose"]);

    // Assertion 2: LLM received the provider's tool in its catalog.
    expect(requests.length).toBeGreaterThan(0);
    const firstRequest = requests[0];
    expect(firstRequest).toBeDefined();
    if (firstRequest === undefined) return;
    const toolNames = (firstRequest.tools ?? []).map((t) => t.name);
    expect(toolNames).toContain("memory_search");

    // Assertion 3: LLM received the systemPromptAdditions concatenated
    // to the inbound `systemPrompt`.
    expect(firstRequest.system).toBeDefined();
    expect(firstRequest.system).toContain("You are a helpful bot.");
    expect(firstRequest.system).toContain("Known facts: user prefers TypeScript.");

    // Assertion 4: dispose fired on the success path.
    expect(calls.filter((c) => c === "dispose").length).toBe(1);

    // Assertion 5: sync fired (finalStatus === "finished").
    expect(result.finalStatus).toBe("finished");
    expect(calls.filter((c) => c === "sync").length).toBe(1);
  });

  it("test_systemPromptAdditions_alone_concat_when_no_inbound_system", async () => {
    if (cwd === undefined) throw new Error("missing workspace");

    const provider: MemoryProvider = {
      async init() {
        return { adapter: makeStubAdapter() };
      },
      buildTools: () => [],
      async runActivePass() {
        return {
          facts: [],
          systemPromptAdditions: "Recalled: user is on free tier.",
        };
      },
      dispose: () => undefined,
    };

    const { client, requests } = buildRecordingStubClient();
    const hooks = new HooksExecutor(cwd);
    await hooks.initialize(false);

    await runAgentLoop({
      agentId: "integration-agent-2",
      runId: "run-2",
      model: { id: "stub-model" },
      userMessage: "test",
      // NO inbound systemPrompt
      llm: client,
      mcp: new Map(),
      hooks,
      shellCwd: cwd,
      shellSandbox: false,
      memoryProvider: provider,
    });

    const firstRequest = requests[0];
    expect(firstRequest).toBeDefined();
    if (firstRequest === undefined) return;
    // With no inbound system, the additions become the system verbatim.
    expect(firstRequest.system).toBe("Recalled: user is on free tier.");
  });

  it("test_no_provider_unchanged_baseline_no_memory_calls", async () => {
    if (cwd === undefined) throw new Error("missing workspace");

    const { client, requests } = buildRecordingStubClient();
    const hooks = new HooksExecutor(cwd);
    await hooks.initialize(false);

    await runAgentLoop({
      agentId: "baseline-agent",
      runId: "run-baseline",
      model: { id: "stub-model" },
      userMessage: "test",
      systemPrompt: "Baseline system.",
      llm: client,
      mcp: new Map(),
      hooks,
      shellCwd: cwd,
      shellSandbox: false,
      // NO memoryProvider — baseline behavior
    });

    const firstRequest = requests[0];
    expect(firstRequest).toBeDefined();
    if (firstRequest === undefined) return;
    // System verbatim; no additions appended.
    expect(firstRequest.system).toBe("Baseline system.");
    // No provider tools in catalog.
    const toolNames = (firstRequest.tools ?? []).map((t) => t.name);
    expect(toolNames).not.toContain("memory_search");
  });

  it("test_provider_throw_swallowed_does_not_abort_run", async () => {
    if (cwd === undefined) throw new Error("missing workspace");

    const provider: MemoryProvider = {
      async init() {
        return { adapter: makeStubAdapter() };
      },
      buildTools: () => {
        throw new Error("buildTools blew");
      },
      async runActivePass() {
        throw new Error("runActivePass blew");
      },
      dispose: () => undefined,
    };

    const { client } = buildRecordingStubClient();
    const hooks = new HooksExecutor(cwd);
    await hooks.initialize(false);

    // The run MUST complete normally; provider throws are swallowed.
    const result = await runAgentLoop({
      agentId: "throw-agent",
      runId: "run-throw",
      model: { id: "stub-model" },
      userMessage: "test",
      llm: client,
      mcp: new Map(),
      hooks,
      shellCwd: cwd,
      shellSandbox: false,
      memoryProvider: provider,
    });
    expect(result.finalStatus).toBe("finished");
  });
});
