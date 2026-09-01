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

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ActiveMemoryPassArgs,
  ActiveMemoryPassResult,
  MemoryAdapter,
  MemoryProvider,
  MemoryProviderHandle,
  MemoryProviderInitOptions,
  SDKAgent,
} from "@theokit/sdk";
import { afterAll, describe, expect, it } from "vitest";
import { driveLoop } from "../helpers/agent-loop-driver.js";
import { removeTempDirRobustSync } from "../helpers/temp-workspace.js";

const CWD = mkdtempSync(join(tmpdir(), "theokit-ordering-"));
afterAll(() => {
  removeTempDirRobustSync(CWD);
});

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
 * CONVERTED 2026-09-01. `simulateAgentLoopMemoryLifecycle` — a 90-line re-implementation of the
 * loop's whole provider lifecycle, complete with its own try/catch swallow semantics — used to
 * stand in for `runAgentLoop`. Its docblock said it "reproduces the actual loop.ts semantics",
 * which is the claim a mirror can never keep: it reproduces them until the loop changes, and
 * nothing tells anyone when that happened.
 *
 * The ordering is now read off the REAL loop by wrapping the provider's own methods in loggers and
 * driving `runAgentLoop`. The observable is the same array of call names; the difference is who
 * produced it.
 */
function withCallLog(provider: MemoryProvider, calls: string[]): MemoryProvider {
  return {
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
    ...(provider.sync === undefined
      ? {}
      : {
          sync: async (h) => {
            calls.push("sync");
            await provider.sync?.(h);
          },
        }),
    dispose: (h) => {
      calls.push("dispose");
      provider.dispose(h);
    },
  };
}

/** Drive one real turn and return the order the loop invoked the provider in. */
async function lifecycleOrder(provider: MemoryProvider): Promise<string[]> {
  const calls: string[] = [];
  await driveLoop(CWD, { memoryProvider: withCallLog(provider, calls) });
  return calls;
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

describe("MemoryProvider lifecycle ordering, read off the real loop", () => {
  it("test_finished_run_full_chain_order", async () => {
    expect(await lifecycleOrder(buildRealProvider())).toEqual([
      "init",
      "buildTools",
      "runActivePass",
      "sync",
      "dispose",
    ]);
  });

  it("test_provider_without_sync_still_completes_the_chain", async () => {
    const noSync = buildRealProvider();
    delete (noSync as { sync?: unknown }).sync;
    const calls = await lifecycleOrder(noSync);
    expect(calls).toEqual(["init", "buildTools", "runActivePass", "dispose"]);
  });

  it("test_init_failure_skips_every_later_phase_and_does_not_dispose", async () => {
    // No handle means nothing to dispose. Calling dispose on a handle that was never produced is
    // the failure mode this asserts against.
    const calls: string[] = [];
    const failing: MemoryProvider = {
      ...buildRealProvider(),
      init: async () => {
        calls.push("init");
        throw new Error("init blew");
      },
    };
    await driveLoop(CWD, { memoryProvider: withCallLog(failing, calls) });
    expect(calls.filter((c) => c !== "init")).toEqual([]);
  });

  it("test_buildTools_throw_does_not_abort_the_later_phases", async () => {
    const calls: string[] = [];
    const base = buildRealProvider();
    const provider: MemoryProvider = {
      ...base,
      buildTools: () => {
        throw new Error("buildTools blew");
      },
    };
    await driveLoop(CWD, { memoryProvider: withCallLog(provider, calls) });
    expect(calls).toContain("runActivePass");
    expect(calls).toContain("dispose");
  });

  it("test_runActivePass_throw_does_not_abort_sync_or_dispose", async () => {
    const calls: string[] = [];
    const base = buildRealProvider();
    const provider: MemoryProvider = {
      ...base,
      runActivePass: async () => {
        throw new Error("pass blew");
      },
    };
    await driveLoop(CWD, { memoryProvider: withCallLog(provider, calls) });
    expect(calls).toContain("sync");
    expect(calls).toContain("dispose");
  });

  it("test_dispose_throw_does_not_propagate_out_of_the_run", async () => {
    const calls: string[] = [];
    const base = buildRealProvider();
    const provider: MemoryProvider = {
      ...base,
      dispose: () => {
        throw new Error("dispose blew");
      },
    };
    const { result } = await driveLoop(CWD, {
      memoryProvider: withCallLog(provider, calls),
    });
    expect(result, "a failing dispose must not fail the run").toBeDefined();
    expect(calls).toContain("dispose");
  });
});
