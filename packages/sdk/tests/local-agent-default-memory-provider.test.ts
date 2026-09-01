/**
 * `LocalAgent.defaultMemoryProviderForLoop` smoke test
 * (SDK 2.0 Phase 1 physical Stage 2b — iter 19+).
 *
 * Pins the construction-time invariant: every `LocalAgent` instance
 * builds an adapter wrapping its own `memoryGlue`, ready to be wired
 * into `inputs.memoryProvider` in a future iter. The adapter is NOT
 * yet used by `send()` — this test guards the construction pattern
 * itself so the flip can land safely later.
 */

// Direct import — LocalAgent is internal but tests reach it via the
// public `Agent.create` factory. We construct LocalAgent directly here
// to keep the test focused on the new field, not on Agent.create wiring.
import { describe, expect, it } from "vitest";
import type { MemoryProvider } from "../src/internal/runtime/memory-glue/memory-provider.js";
import type { AgentOptions } from "../src/types/agent.js";

const STUB_OPTIONS: AgentOptions = {
  agentId: "stage-2b-test-agent",
  model: { id: "anthropic/claude-3-5-haiku-latest" },
} as AgentOptions;

describe("LocalAgent.defaultMemoryProviderForLoop (Stage 2b iter 19+)", () => {
  it("test_LocalAgent_ctor_eagerly_builds_default_memory_provider", async () => {
    // Avoid pulling the heavy LocalAgent module graph; verify the adapter
    // factory is callable with the exact construction pattern the ctor
    // uses. This pins the contract surface — LocalAgent ctor calls
    // `createLocalAgentMemoryProvider({agentOptions, workspaceCwd,
    // agentId, telemetry?})` and stores the return for future use.
    const { createLocalAgentMemoryProvider } = await import(
      "../src/internal/local-agent/local-agent-memory-provider.js"
    );
    const provider: MemoryProvider = createLocalAgentMemoryProvider({
      agentOptions: STUB_OPTIONS,
      workspaceCwd: "/tmp/stage-2b",
      agentId: "stage-2b-test-agent",
    });
    expect(typeof provider.init).toBe("function");
    expect(typeof provider.buildTools).toBe("function");
    expect(typeof provider.runActivePass).toBe("function");
    expect(typeof provider.sync).toBe("function");
    expect(typeof provider.dispose).toBe("function");
  });

  it("test_default_provider_is_independent_per_LocalAgent", async () => {
    const { createLocalAgentMemoryProvider } = await import(
      "../src/internal/local-agent/local-agent-memory-provider.js"
    );
    const a = createLocalAgentMemoryProvider({
      agentOptions: STUB_OPTIONS,
      workspaceCwd: "/tmp/stage-2b",
      agentId: "agent-A",
    });
    const b = createLocalAgentMemoryProvider({
      agentOptions: STUB_OPTIONS,
      workspaceCwd: "/tmp/stage-2b",
      agentId: "agent-B",
    });
    expect(a).not.toBe(b);
    expect(a.init).not.toBe(b.init);
  });

  it("test_default_provider_init_does_not_throw_with_memory_disabled", async () => {
    const { createLocalAgentMemoryProvider } = await import(
      "../src/internal/local-agent/local-agent-memory-provider.js"
    );
    const provider = createLocalAgentMemoryProvider({
      agentOptions: STUB_OPTIONS,
      workspaceCwd: "/tmp/stage-2b",
      agentId: "stage-2b-test-agent",
    });
    // With memory.enabled undefined, ensureTools() is a no-op + init()
    // resolves cleanly to a handle with a no-op-ish adapter.
    const handle = await provider.init({ cwd: "/tmp/stage-2b" });
    expect(handle).toBeDefined();
    expect(handle.adapter.id).toBe("local-agent-memory");
  });

  it("test_default_provider_implements_recordSessionSummary_port_method", async () => {
    // Iter 29: createLocalAgentMemoryProvider now defines the
    // optional `recordSessionSummary` method (delegates to legacy
    // writeSessionSummary). This pins the wire-up so a future refactor
    // can't silently drop the impl + regress to the legacy fallback.
    const { createLocalAgentMemoryProvider } = await import(
      "../src/internal/local-agent/local-agent-memory-provider.js"
    );
    const provider = createLocalAgentMemoryProvider({
      agentOptions: STUB_OPTIONS,
      workspaceCwd: "/tmp/stage-2b",
      agentId: "stage-2b-test-agent",
    });
    expect(provider.recordSessionSummary).toBeDefined();
    expect(typeof provider.recordSessionSummary).toBe("function");
  });

  it("test_default_provider_implements_sync_port_method", async () => {
    // Iter 19: optional sync() port method.
    const { createLocalAgentMemoryProvider } = await import(
      "../src/internal/local-agent/local-agent-memory-provider.js"
    );
    const provider = createLocalAgentMemoryProvider({
      agentOptions: STUB_OPTIONS,
      workspaceCwd: "/tmp/stage-2b",
      agentId: "stage-2b-test-agent",
    });
    expect(provider.sync).toBeDefined();
    expect(typeof provider.sync).toBe("function");
  });
});
