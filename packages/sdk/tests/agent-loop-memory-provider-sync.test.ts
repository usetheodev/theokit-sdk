/**
 * `MemoryProvider.sync()` post-run hook wiring tests
 * (SDK 2.0 Phase 1 physical Stage 1 — iter 19).
 *
 * Mirrors the iter 15-16 BudgetTracker + iter 18 T1.5.* wiring
 * discipline. The hook is OPTIONAL on the port — undefined `sync` MUST
 * be a no-op (back-compat with existing impls). When defined, it
 * fires only on `finalStatus === "finished"` runs.
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

function buildProviderWithSync(opts?: { syncThrows?: boolean }) {
  const initSpy = vi.fn(
    async (_o: MemoryProviderInitOptions): Promise<MemoryProviderHandle> => ({
      adapter: makeStubAdapter(),
    }),
  );
  const buildToolsSpy = vi.fn((_h: MemoryProviderHandle, _a: SDKAgent) => []);
  const runActivePassSpy = vi.fn(
    async (
      _h: MemoryProviderHandle,
      _a: ActiveMemoryPassArgs,
    ): Promise<ActiveMemoryPassResult> => ({ facts: [] }),
  );
  const syncSpy = vi.fn(async (_h: MemoryProviderHandle): Promise<void> => {
    if (opts?.syncThrows) throw new Error("sync blew");
  });
  const disposeSpy = vi.fn((_h: MemoryProviderHandle): void => undefined);
  const provider: MemoryProvider = {
    init: initSpy,
    buildTools: buildToolsSpy,
    runActivePass: runActivePassSpy,
    sync: syncSpy,
    dispose: disposeSpy,
  };
  return { provider, initSpy, syncSpy, disposeSpy };
}

/** Mirror of the wiring at `loop.ts` ~ before the loop return. */
async function performPostRunSync(
  provider: MemoryProvider | undefined,
  handle: MemoryProviderHandle | undefined,
  finalStatus: "finished" | "error",
): Promise<void> {
  if (finalStatus === "finished" && handle !== undefined && provider?.sync !== undefined) {
    try {
      await provider.sync(handle);
    } catch {
      // swallow
    }
  }
}

describe("MemoryProvider.sync() wiring (Phase 1 physical Stage 1 — iter 19)", () => {
  it("test_sync_optional_undefined_is_no_op", () => {
    const provider: MemoryProvider = {
      init: async () => ({ adapter: makeStubAdapter() }),
      buildTools: () => [],
      runActivePass: async () => ({ facts: [] }),
      // sync intentionally omitted
      dispose: () => undefined,
    };
    // Type-level: sync is optional
    expect(provider.sync).toBeUndefined();
  });

  it("test_sync_fires_on_finished_runs", async () => {
    const { provider, syncSpy } = buildProviderWithSync();
    const handle = await provider.init({ cwd: "/tmp" });
    await performPostRunSync(provider, handle, "finished");
    expect(syncSpy).toHaveBeenCalledTimes(1);
    expect(syncSpy).toHaveBeenCalledWith(handle);
  });

  it("test_sync_skipped_on_error_runs", async () => {
    const { provider, syncSpy } = buildProviderWithSync();
    const handle = await provider.init({ cwd: "/tmp" });
    await performPostRunSync(provider, handle, "error");
    expect(syncSpy).not.toHaveBeenCalled();
  });

  it("test_sync_skipped_when_handle_undefined", async () => {
    const { provider, syncSpy } = buildProviderWithSync();
    await performPostRunSync(provider, undefined, "finished");
    expect(syncSpy).not.toHaveBeenCalled();
  });

  it("test_sync_throw_swallowed_does_not_propagate", async () => {
    const { provider, syncSpy } = buildProviderWithSync({ syncThrows: true });
    const handle = await provider.init({ cwd: "/tmp" });
    await expect(performPostRunSync(provider, handle, "finished")).resolves.toBeUndefined();
    expect(syncSpy).toHaveBeenCalledTimes(1);
  });

  it("test_sync_skipped_when_provider_has_no_sync_method", async () => {
    const provider: MemoryProvider = {
      init: async () => ({ adapter: makeStubAdapter() }),
      buildTools: () => [],
      runActivePass: async () => ({ facts: [] }),
      // no sync method
      dispose: () => undefined,
    };
    const handle = await provider.init({ cwd: "/tmp" });
    // Should not throw, just skip
    await expect(performPostRunSync(provider, handle, "finished")).resolves.toBeUndefined();
  });
});
