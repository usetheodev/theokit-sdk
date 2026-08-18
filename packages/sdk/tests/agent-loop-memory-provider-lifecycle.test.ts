/**
 * Lifecycle wiring tests for `MemoryProvider.init()` + `dispose()`
 * (SDK 2.0 Phase 1 / T1.5.1 — first runtime hook).
 *
 * Cannot drive the full agent-loop here without a stubbed LLM (would
 * pull a deep mock setup). Instead, tests the EXACT BRANCH LOGIC the
 * wiring in `loop.ts` implements: given a spy provider + an inputs
 * shape, the same lifecycle calls MUST fire here. Mirrors
 * `agent-loop-budget-tracker-wiring.test.ts` iter 15 discipline.
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
import { describe, expect, it, vi } from "vitest";

/** Build a spy MemoryProvider whose lifecycle methods record their calls. */
function buildSpyProvider(opts?: { initThrows?: boolean; disposeThrows?: boolean }) {
  const initSpy = vi.fn(async (_o: MemoryProviderInitOptions): Promise<MemoryProviderHandle> => {
    if (opts?.initThrows) throw new Error("init blew");
    return {
      adapter: {
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
      } satisfies MemoryAdapter,
    };
  });
  const buildToolsSpy = vi.fn((_h: MemoryProviderHandle, _a: SDKAgent) => []);
  const runActivePassSpy = vi.fn(
    async (
      _h: MemoryProviderHandle,
      _a: ActiveMemoryPassArgs,
    ): Promise<ActiveMemoryPassResult> => ({
      facts: [],
    }),
  );
  const disposeSpy = vi.fn((_h: MemoryProviderHandle): void => {
    if (opts?.disposeThrows) throw new Error("dispose blew");
  });
  const provider: MemoryProvider = {
    init: initSpy,
    buildTools: buildToolsSpy,
    runActivePass: runActivePassSpy,
    dispose: disposeSpy,
  };
  return { provider, initSpy, buildToolsSpy, runActivePassSpy, disposeSpy };
}

/**
 * Mirror of the wiring at `loop.ts` ~ lines 200-220 (`initLoopContext`).
 * Calls `provider.init(...)` once with `process.cwd()`; swallows init
 * errors (handle stays undefined when init throws).
 */
async function performInit(
  provider: MemoryProvider | undefined,
): Promise<MemoryProviderHandle | undefined> {
  if (provider === undefined) return undefined;
  try {
    return await provider.init({ cwd: process.cwd() });
  } catch {
    return undefined;
  }
}

/**
 * Mirror of the wiring at `loop.ts` ~ finally block.
 * Calls `provider.dispose(...)` when both provider AND handle are set.
 * Swallows dispose throw per contract (non-throwing on hot path).
 */
async function performDispose(
  provider: MemoryProvider | undefined,
  handle: MemoryProviderHandle | undefined,
): Promise<void> {
  if (provider === undefined || handle === undefined) return;
  try {
    await provider.dispose(handle);
  } catch {
    // swallow
  }
}

describe("MemoryProvider init + dispose wiring (Phase 1 / T1.5.1)", () => {
  it("test_no_provider_means_no_init_or_dispose", async () => {
    // The "no init" half is asserted below. The "no dispose" half is NOT, and cannot be from here:
    // `performDispose` is a test-local mirror whose `catch {}` swallows anything the absent-provider
    // path could do, so nothing about the call is observable. It used to end in
    // `expect(true).toBe(true)`, which dressed that gap as coverage. The call stays (it documents
    // the shape and executes the guard); the fake oracle does not. Registered as B-095 — the mirror
    // has to be replaced by the production path before this half can be tested at all.
    const handle = await performInit(undefined);
    expect(handle).toBeUndefined();
    await performDispose(undefined, undefined);
  });

  it("test_provider_init_called_once_returns_handle", async () => {
    const { provider, initSpy } = buildSpyProvider();
    const handle = await performInit(provider);
    expect(initSpy).toHaveBeenCalledTimes(1);
    expect(initSpy).toHaveBeenCalledWith({ cwd: process.cwd() });
    expect(handle).toBeDefined();
    expect(handle?.adapter.id).toBe("spy");
  });

  it("test_provider_dispose_called_when_handle_set", async () => {
    const { provider, disposeSpy } = buildSpyProvider();
    const handle = await performInit(provider);
    await performDispose(provider, handle);
    expect(disposeSpy).toHaveBeenCalledTimes(1);
    expect(disposeSpy).toHaveBeenCalledWith(handle);
  });

  it("test_dispose_skipped_when_init_threw — no double-dispose risk", async () => {
    const { provider, initSpy, disposeSpy } = buildSpyProvider({ initThrows: true });
    const handle = await performInit(provider);
    expect(initSpy).toHaveBeenCalledTimes(1);
    expect(handle).toBeUndefined();
    // Mirror loop.ts: dispose only fires when handle !== undefined
    await performDispose(provider, handle);
    expect(disposeSpy).not.toHaveBeenCalled();
  });

  it("test_dispose_throw_swallowed — does not propagate up the loop", async () => {
    const { provider, disposeSpy } = buildSpyProvider({ disposeThrows: true });
    const handle = await performInit(provider);
    await expect(performDispose(provider, handle)).resolves.toBeUndefined();
    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });

  it("test_init_called_once_per_send — even when same provider re-supplied", async () => {
    const { provider, initSpy } = buildSpyProvider();
    // Two distinct sends each get their own init call (not cached
    // cross-send at the loop layer — that's the impl's concern).
    await performInit(provider);
    await performInit(provider);
    expect(initSpy).toHaveBeenCalledTimes(2);
  });

  it("test_lifecycle_smoke — full chain with no-op handle", async () => {
    const { provider, initSpy, disposeSpy } = buildSpyProvider();
    const handle = await performInit(provider);
    expect(handle).toBeDefined();
    expect(initSpy).toHaveBeenCalledTimes(1);
    await performDispose(provider, handle);
    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });
});
