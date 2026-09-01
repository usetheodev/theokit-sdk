/**
 * `MemoryProvider` interface contract tests (SDK 2.0 Phase 1 / T1.1
 * foundation — Hexagonal Architecture / Ports & Adapters).
 *
 * These tests pin the public interface SHAPE. They do NOT exercise the
 * eventual Agent.create wiring (lands in subsequent iteration). Goal:
 * lock the contract so impls (default no-op today; `@theokit/sdk-memory`
 * after Phase 1) can conform without breaking changes.
 *
 * Mirrors `budget-tracker-interface.test.ts` (iter 10 — same FAANG-style
 * interface inversion, different subsystem).
 */

import type {
  ActiveMemoryPassArgs,
  ActiveMemoryPassResult,
  MemoryAdapter,
  MemoryAdapterCapabilities,
  MemoryProvider,
  MemoryProviderHandle,
  MemoryProviderInitOptions,
  SDKAgent,
} from "@theokit/sdk";
import { describe, expect, expectTypeOf, it } from "vitest";

/** Shared stub capabilities — all false, matches a strict no-op adapter. */
const STUB_CAPABILITIES: MemoryAdapterCapabilities = {
  history: false,
  sessions: false,
  tenancy: false,
  reasoning: false,
  toolSchemas: false,
  prefetch: false,
};

/** Minimal MemoryAdapter stub satisfying the public contract (id + capabilities + isAvailable + write + recall + delete). */
function makeStubAdapter(id = "stub"): MemoryAdapter {
  return {
    id,
    capabilities: STUB_CAPABILITIES,
    isAvailable: () => true,
    write: async () => `${id}:noop` as never,
    recall: async () => [],
    delete: async () => undefined,
  };
}

describe("MemoryProvider port (Phase 1 / T1.1 foundation)", () => {
  it("test_init_options_shape — cwd required, embeddingProviderId optional", () => {
    const minimal: MemoryProviderInitOptions = { cwd: "/tmp" };
    expect(minimal.cwd).toBe("/tmp");

    const withProvider: MemoryProviderInitOptions = {
      cwd: "/tmp",
      embeddingProviderId: "openai",
    };
    expect(withProvider.embeddingProviderId).toBe("openai");
  });

  it("test_active_pass_args_shape — userMessage + history + agentId required", () => {
    const args: ActiveMemoryPassArgs = {
      userMessage: "what's my preference?",
      history: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
      ],
      agentId: "agent-1",
    };
    expect(args.history.length).toBe(2);
    expectTypeOf<ActiveMemoryPassArgs["history"][number]["role"]>().toEqualTypeOf<
      "user" | "assistant"
    >();
  });

  it("test_active_pass_result_shape — facts required, optional sysPromptAdditions + breakerTripped", () => {
    const minimal: ActiveMemoryPassResult = { facts: [] };
    expect(minimal.facts.length).toBe(0);

    const full: ActiveMemoryPassResult = {
      facts: [],
      systemPromptAdditions: "User prefers TypeScript.",
      breakerTripped: false,
    };
    expect(full.breakerTripped).toBe(false);
    expect(full.systemPromptAdditions).toContain("TypeScript");
  });

  it("test_handle_shape — has adapter + opaque symbol-keyed implState", () => {
    const HANDLE_KEY = Symbol("test-handle");
    const handle: MemoryProviderHandle = {
      adapter: makeStubAdapter(),
      [HANDLE_KEY]: { index: "stub" },
    };
    expect(handle.adapter).toBeDefined();
    expect(handle[HANDLE_KEY]).toEqual({ index: "stub" });
  });

  it("test_provider_shape — init + buildTools + runActivePass + dispose", () => {
    const noopProvider: MemoryProvider = {
      init: async (_opts: MemoryProviderInitOptions) => {
        return { adapter: makeStubAdapter() };
      },
      buildTools: (_handle: MemoryProviderHandle, _agent: SDKAgent) => [],
      runActivePass: async (_handle: MemoryProviderHandle, _args: ActiveMemoryPassArgs) => ({
        facts: [],
      }),
      dispose: () => undefined,
    };
    expect(typeof noopProvider.init).toBe("function");
    expect(typeof noopProvider.buildTools).toBe("function");
    expect(typeof noopProvider.runActivePass).toBe("function");
    expect(typeof noopProvider.dispose).toBe("function");
  });

  it("test_provider_lifecycle_smoke — init → buildTools → runActivePass → dispose", async () => {
    const noopProvider: MemoryProvider = {
      init: async (_opts: MemoryProviderInitOptions) => ({
        adapter: makeStubAdapter(),
      }),
      buildTools: (_handle: MemoryProviderHandle, _agent: SDKAgent) => [],
      runActivePass: async (_handle: MemoryProviderHandle, _args: ActiveMemoryPassArgs) => ({
        facts: [],
        breakerTripped: false,
      }),
      dispose: () => undefined,
    };

    const handle = await noopProvider.init({ cwd: "/tmp" });
    const tools = noopProvider.buildTools(handle, {} as SDKAgent);
    const passResult = await noopProvider.runActivePass(handle, {
      userMessage: "test",
      history: [],
      agentId: "a",
    });
    await noopProvider.dispose(handle);

    expect(tools.length).toBe(0);
    expect(passResult.facts.length).toBe(0);
    expect(passResult.breakerTripped).toBe(false);
  });
});
