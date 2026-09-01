/**
 * The `MemoryProvider.init()` / `dispose()` lifecycle wiring (SDK 2.0 Phase 1 / T1.5.1).
 *
 * ## B-095 — what this file used to be
 *
 * It carried two test-local mirrors, `performInit` and `performDispose`, annotated "Mirror of the
 * wiring in `initLoopContext`" and "Mirror of the wiring at `loop.ts` ~ finally block". Every case
 * exercised the copy. The copy passes for as long as someone remembers to edit it alongside the
 * code — which is the property the file was named for, assumed instead of verified. Measured while
 * repairing B-065: deleting the undefined-guard from the mirror left every case green, and so would
 * any change to the real `loop.ts`.
 *
 * The stated reason was that driving the loop "without a stubbed LLM ... would pull a deep mock
 * setup". `LlmClient` has two members; the stub below is nine lines, and eighteen files in this
 * package already do it.
 *
 * Every case now drives the production `runAgentLoop`. The lifecycle is observed where it actually
 * happens: `init` inside `initLoopContext`, `dispose` inside the loop's `finally`.
 */

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { runAgentLoop } from "../../src/internal/agent-loop/loop.js";
import type { LlmClient, LlmEvent, LlmFinish } from "../../src/internal/llm/types.js";
import { HooksExecutor } from "../../src/internal/runtime/hooks/hooks-executor.js";
import type {
  MemoryProvider,
  MemoryProviderHandle,
  MemoryProviderInitOptions,
} from "../../src/internal/runtime/memory/memory-provider.js";
import { stubMemoryAdapter } from "../helpers/memory-stubs.js";
import { removeTempDirRobust, useTempCwd } from "../helpers/temp-workspace.js";

// This file passed `cwd: process.cwd()`, which during a test run is the package itself, so
// every agent it created persisted a real session into packages/sdk/.theokit/. The helper
// makes process.cwd() report a throwaway directory for this file only.
useTempCwd();

/** A MemoryAdapter satisfying the public contract; the handle's payload, nothing more. */

function spyProvider(opts?: { initThrows?: boolean; disposeThrows?: boolean }) {
  const init = vi.fn(async (_o: MemoryProviderInitOptions): Promise<MemoryProviderHandle> => {
    if (opts?.initThrows === true) throw new Error("init blew");
    return { adapter: stubMemoryAdapter() };
  });
  const dispose = vi.fn((_h: MemoryProviderHandle): void => {
    if (opts?.disposeThrows === true) throw new Error("dispose blew");
  });
  const provider: MemoryProvider = {
    init,
    buildTools: () => [],
    runActivePass: async () => ({ facts: [] }),
    dispose,
  };
  return { provider, init, dispose };
}

/** A one-round LLM that answers and stops. */
const okClient: LlmClient = {
  name: "stub",
  async *stream(): AsyncGenerator<LlmEvent, LlmFinish, void> {
    yield { type: "text_delta", text: "ok" };
    return { stopReason: "end_turn", text: "ok", toolCalls: [] };
  },
};

/** An LLM whose stream dies mid-round, driving the loop to `finalStatus: "error"`. */
const failingClient: LlmClient = {
  name: "stub",
  // biome-ignore lint/correctness/useYield: the stream dies before it can yield
  async *stream(): AsyncGenerator<LlmEvent, LlmFinish, void> {
    throw new Error("transport died mid-stream");
  },
};

describe("MemoryProvider init + dispose, against the production runAgentLoop", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "theokit-mem-lifecycle-"));
    const __cwdCleanup1 = cwd;
    onTestFinished(async () => {
      await removeTempDirRobust(__cwdCleanup1);
    });
  });

  async function drive(
    provider: MemoryProvider | undefined,
    options?: { llm?: LlmClient; agentId?: string },
  ): Promise<Awaited<ReturnType<typeof runAgentLoop>>> {
    const hooks = new HooksExecutor(cwd);
    await hooks.initialize(false);
    return runAgentLoop({
      agentId: options?.agentId ?? "mem-lifecycle",
      runId: "run-mem-lifecycle",
      model: { id: "stub-model" },
      userMessage: "hello",
      llm: options?.llm ?? okClient,
      mcp: new Map(),
      hooks,
      shellCwd: cwd,
      shellSandbox: false,
      ...(provider !== undefined ? { memoryProvider: provider } : {}),
    });
  }

  it("test_init_fires_once_per_send_and_its_handle_is_the_one_disposed", async () => {
    // Kills: dropping either call; disposing a freshly built handle instead of the one `init`
    // returned — which would leak the real one and hand the provider an object it never issued.
    const { provider, init, dispose } = spyProvider();

    const result = await drive(provider);

    expect(result.finalStatus).toBe("finished");
    expect(init).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
    const issuedHandle = await init.mock.results[0]?.value;
    expect(dispose).toHaveBeenCalledWith(issuedHandle);
  });

  it("test_init_receives_the_process_cwd_the_wiring_passes", async () => {
    // Pins the argument, which is the half a call-count assertion cannot see. Recorded as measured:
    // the loop passes `process.cwd()`, NOT the run's `shellCwd` — the temp dir above is not what
    // arrives. A provider resolving storage from this value therefore ignores the run's workspace.
    const { provider, init } = spyProvider();

    await drive(provider);

    expect(init).toHaveBeenCalledWith({ cwd: process.cwd() });
    expect(init.mock.calls[0]?.[0].cwd).not.toBe(cwd);
  });

  it("test_dispose_still_fires_when_the_run_ends_in_error", async () => {
    // The reason the call lives in a `finally`. A provider holding a connection must be released on
    // the failure path too, which is the path a leak actually happens on. Kills: moving `dispose`
    // out of `finally` into the success branch.
    const { provider, init, dispose } = spyProvider();

    const result = await drive(provider, { llm: failingClient });

    expect(result.finalStatus).toBe("error");
    expect(init).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("test_a_failed_init_is_never_disposed", async () => {
    // No handle was issued, so there is nothing to release; calling `dispose(undefined)` would hand
    // the provider a handle it never created. Kills: dropping the
    // `ctxRef.memoryProviderHandle !== undefined` guard in the `finally`.
    const { provider, init, dispose } = spyProvider({ initThrows: true });

    const result = await drive(provider);

    expect(init).toHaveBeenCalledTimes(1);
    expect(dispose).not.toHaveBeenCalled();
    // And the run survives a provider that cannot start: memory is an enhancement, not a gate.
    expect(result.finalStatus).toBe("finished");
    expect(result.result).toBe("ok");
  });

  it("test_a_throwing_dispose_does_not_take_the_run_down", async () => {
    // `dispose` is contracted non-throwing on the hot path, and it runs inside the `finally` — an
    // escape there would replace the run's own outcome with the cleanup's error, which
    // `error-handling.md` forbids.
    const { provider, dispose } = spyProvider({ disposeThrows: true });

    const result = await drive(provider);

    expect(result.finalStatus).toBe("finished");
    expect(result.result).toBe("ok");
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("test_each_send_gets_its_own_init_and_dispose_pair", async () => {
    // The handle is per-run, not cached across sends. Two sends, two complete pairs.
    const { provider, init, dispose } = spyProvider();

    await drive(provider, { agentId: "mem-lifecycle-a" });
    await drive(provider, { agentId: "mem-lifecycle-b" });

    expect(init).toHaveBeenCalledTimes(2);
    expect(dispose).toHaveBeenCalledTimes(2);
    const first = await init.mock.results[0]?.value;
    const second = await init.mock.results[1]?.value;
    expect(first).not.toBe(second);
    expect(dispose.mock.calls[0]?.[0]).toBe(first);
    expect(dispose.mock.calls[1]?.[0]).toBe(second);
  });

  it("test_a_run_with_no_provider_is_unaffected", async () => {
    // § 4.2 — the accepted case. Wiring that threw whenever no provider was supplied would pass
    // every case above.
    const result = await drive(undefined);

    expect(result.finalStatus).toBe("finished");
    expect(result.result).toBe("ok");
  });
});
