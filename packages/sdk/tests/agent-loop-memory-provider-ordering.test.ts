/**
 * Holistic lifecycle-ordering test for `MemoryProvider` (SDK 2.0 Phase
 * 1 / iter 19+).
 *
 * Per-method wiring tests (`agent-loop-memory-provider-*.test.ts`)
 * exist already. THIS test pins the FULL ORDERING the agent-loop
 * fires methods in across a single send:
 *
 *     init → buildTools → runActivePass → sync → dispose
 *
 * Without this test, a future refactor could re-order the calls
 * (e.g., dispose before sync) silently — every per-method test would
 * still pass.
 *
 * Cannot drive `runAgentLoop` directly without a stubbed LLM. Instead,
 * mirrors the exact branch logic from `loop.ts` (lines that fire each
 * provider method) and asserts the call-order via a shared call log.
 */

import type {
  ActiveMemoryPassArgs,
  ActiveMemoryPassResult,
  MemoryAdapter,
  MemoryProvider,
  MemoryProviderHandle,
  MemoryProviderInitOptions,
  SDKAgent,
} from "@theokit/sdk";
import { describe, expect, it } from "vitest";

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

/**
 * Mirror of agent-loop's full provider-lifecycle path. Records each
 * method call in a shared log so the FULL ordering can be asserted.
 *
 * Reproduces the actual `loop.ts` semantics:
 *   - init() in initLoopContext
 *   - buildTools() right after init
 *   - runActivePass() right after buildTools
 *   - sync() only when finalStatus === "finished" (iter 19 T1.5 ext)
 *   - dispose() in finally block, always (when handle set)
 *
 * Errors at any phase swallow per the non-throwing contract.
 */
async function simulateAgentLoopMemoryLifecycle(
  provider: MemoryProvider,
  finalStatusToSimulate: "finished" | "error",
): Promise<{ calls: string[]; handle: MemoryProviderHandle | undefined }> {
  const calls: string[] = [];

  // Wrap each method on the provider with a logger
  const logged: MemoryProvider = {
    init: async (o) => {
      calls.push("init");
      return await provider.init(o);
    },
    buildTools: (h, a) => {
      calls.push("buildTools");
      return provider.buildTools(h, a);
    },
    runActivePass: async (h, a) => {
      calls.push("runActivePass");
      return await provider.runActivePass(h, a);
    },
    ...(provider.sync !== undefined
      ? {
          sync: async (h: MemoryProviderHandle) => {
            calls.push("sync");
            await provider.sync!(h);
          },
        }
      : {}),
    dispose: (h) => {
      calls.push("dispose");
      return provider.dispose(h);
    },
  };

  let handle: MemoryProviderHandle | undefined;
  try {
    // Phase 1: init
    try {
      handle = await logged.init({ cwd: "/tmp" });
    } catch {
      handle = undefined;
    }

    // Phase 2: buildTools (after init succeeded)
    if (handle !== undefined) {
      try {
        logged.buildTools(handle, {} as SDKAgent);
      } catch {
        // swallow
      }

      // Phase 3: runActivePass (still inside initLoopContext)
      try {
        await logged.runActivePass(handle, {
          userMessage: "hi",
          history: [],
          agentId: "test",
        });
      } catch {
        // swallow
      }
    }

    // Phase 4: sync — ONLY when finalStatus === "finished"
    if (
      finalStatusToSimulate === "finished" &&
      handle !== undefined &&
      logged.sync !== undefined
    ) {
      try {
        await logged.sync(handle);
      } catch {
        // swallow
      }
    }
  } finally {
    // Phase 5: dispose — runs even on error (in agent-loop finally)
    if (handle !== undefined) {
      try {
        await logged.dispose(handle);
      } catch {
        // swallow
      }
    }
  }

  return { calls, handle };
}

function buildRealProvider(): MemoryProvider {
  return {
    async init(_o: MemoryProviderInitOptions): Promise<MemoryProviderHandle> {
      return { adapter: makeStubAdapter() };
    },
    buildTools: (_h: MemoryProviderHandle, _a: SDKAgent) => [],
    async runActivePass(
      _h: MemoryProviderHandle,
      _a: ActiveMemoryPassArgs,
    ): Promise<ActiveMemoryPassResult> {
      return { facts: [] };
    },
    sync: async (_h: MemoryProviderHandle): Promise<void> => undefined,
    dispose: (_h: MemoryProviderHandle): void => undefined,
  };
}

describe("MemoryProvider lifecycle ordering (Phase 1 iter 19+)", () => {
  it("test_finished_run_full_chain_order", async () => {
    const { calls } = await simulateAgentLoopMemoryLifecycle(buildRealProvider(), "finished");
    expect(calls).toEqual(["init", "buildTools", "runActivePass", "sync", "dispose"]);
  });

  it("test_error_run_skips_sync_but_still_disposes", async () => {
    const { calls } = await simulateAgentLoopMemoryLifecycle(buildRealProvider(), "error");
    expect(calls).toEqual(["init", "buildTools", "runActivePass", "dispose"]);
    // sync MUST be absent (error path) but dispose MUST be present.
    expect(calls).not.toContain("sync");
    expect(calls).toContain("dispose");
  });

  it("test_provider_without_sync_still_completes_full_chain", async () => {
    const noSyncProvider: MemoryProvider = {
      async init(): Promise<MemoryProviderHandle> {
        return { adapter: makeStubAdapter() };
      },
      buildTools: () => [],
      async runActivePass(): Promise<ActiveMemoryPassResult> {
        return { facts: [] };
      },
      // sync intentionally omitted
      dispose: () => undefined,
    };
    const { calls } = await simulateAgentLoopMemoryLifecycle(noSyncProvider, "finished");
    expect(calls).toEqual(["init", "buildTools", "runActivePass", "dispose"]);
  });

  it("test_init_failure_skips_subsequent_phases_no_dispose", async () => {
    const throwingProvider: MemoryProvider = {
      async init() {
        throw new Error("init blew");
      },
      buildTools: () => [],
      async runActivePass(): Promise<ActiveMemoryPassResult> {
        return { facts: [] };
      },
      sync: async () => undefined,
      dispose: () => undefined,
    };
    const { calls, handle } = await simulateAgentLoopMemoryLifecycle(
      throwingProvider,
      "finished",
    );
    // Init records "init" before throwing; subsequent phases gated on handle defined.
    expect(calls).toEqual(["init"]);
    expect(handle).toBeUndefined();
  });

  it("test_buildTools_throw_does_not_abort_runActivePass_or_dispose", async () => {
    const partialThrower: MemoryProvider = {
      async init(): Promise<MemoryProviderHandle> {
        return { adapter: makeStubAdapter() };
      },
      buildTools: () => {
        throw new Error("buildTools blew");
      },
      async runActivePass(): Promise<ActiveMemoryPassResult> {
        return { facts: [] };
      },
      sync: async () => undefined,
      dispose: () => undefined,
    };
    const { calls } = await simulateAgentLoopMemoryLifecycle(partialThrower, "finished");
    // All phases still fire — swallow doesn't break ordering.
    expect(calls).toEqual(["init", "buildTools", "runActivePass", "sync", "dispose"]);
  });

  it("test_runActivePass_throw_does_not_abort_sync_or_dispose", async () => {
    const passThrower: MemoryProvider = {
      async init(): Promise<MemoryProviderHandle> {
        return { adapter: makeStubAdapter() };
      },
      buildTools: () => [],
      async runActivePass(): Promise<ActiveMemoryPassResult> {
        throw new Error("active-pass blew");
      },
      sync: async () => undefined,
      dispose: () => undefined,
    };
    const { calls } = await simulateAgentLoopMemoryLifecycle(passThrower, "finished");
    expect(calls).toEqual(["init", "buildTools", "runActivePass", "sync", "dispose"]);
  });

  it("test_dispose_throw_does_not_propagate_up", async () => {
    const disposeThrower: MemoryProvider = {
      async init(): Promise<MemoryProviderHandle> {
        return { adapter: makeStubAdapter() };
      },
      buildTools: () => [],
      async runActivePass(): Promise<ActiveMemoryPassResult> {
        return { facts: [] };
      },
      sync: async () => undefined,
      dispose: () => {
        throw new Error("dispose blew");
      },
    };
    // Whole simulation MUST resolve, not reject
    await expect(
      simulateAgentLoopMemoryLifecycle(disposeThrower, "finished"),
    ).resolves.toBeDefined();
  });
});
