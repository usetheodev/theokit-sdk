/**
 * `MemoryProvider.sync()` post-run hook wiring tests
 * (SDK 2.0 Phase 1 physical Stage 1 — iter 19).
 *
 * Mirrors the iter 15-16 BudgetTracker + iter 18 T1.5.* wiring
 * discipline. The hook is OPTIONAL on the port — undefined `sync` MUST
 * be a no-op (back-compat with existing impls). When defined, it
 * fires only on `finalStatus === "finished"` runs.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ActiveMemoryPassArgs,
  ActiveMemoryPassResult,
  MemoryProvider,
  MemoryProviderHandle,
  MemoryProviderInitOptions,
  SDKAgent,
} from "@theokit/sdk";
import { afterAll, describe, expect, it, vi } from "vitest";
import { driveLoop } from "../helpers/agent-loop-driver.js";
import { stubMemoryAdapter } from "../helpers/memory-stubs.js";
import { removeTempDirRobustSync } from "../helpers/temp-workspace.js";

const CWD = mkdtempSync(join(tmpdir(), "theokit-provsync-"));
afterAll(() => {
  removeTempDirRobustSync(CWD);
});

function buildProviderWithSync(opts?: { syncThrows?: boolean }) {
  const initSpy = vi.fn(
    async (_o: MemoryProviderInitOptions): Promise<MemoryProviderHandle> => ({
      adapter: stubMemoryAdapter(),
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

describe("MemoryProvider.sync() at the end of a run, driven through runAgentLoop", () => {
  it("test_sync_fires_on_a_finished_run", async () => {
    const { provider, syncSpy } = buildProviderWithSync();
    await driveLoop(CWD, { memoryProvider: provider });
    expect(syncSpy).toHaveBeenCalledTimes(1);
  });

  it("test_sync_receives_the_handle_init_returned", async () => {
    const { provider, syncSpy, initSpy } = buildProviderWithSync();
    await driveLoop(CWD, { memoryProvider: provider });
    const handle = await initSpy.mock.results[0]?.value;
    expect(syncSpy.mock.calls[0]?.[0]).toBe(handle);
  });

  it("test_sync_throw_is_swallowed_and_the_run_still_returns", async () => {
    // sync() is documented as non-throwing on the hot path: a memory backend that fails to flush
    // must not turn a completed run into a failed one.
    const { provider, syncSpy } = buildProviderWithSync({ syncThrows: true });
    const { result } = await driveLoop(CWD, { memoryProvider: provider });
    expect(syncSpy).toHaveBeenCalledTimes(1);
    expect(result, "a failing sync must not abort a finished run").toBeDefined();
  });

  it("test_a_provider_without_sync_is_a_no_op", async () => {
    // `sync` is optional on the port. The loop must not assume it exists.
    const { provider } = buildProviderWithSync();
    const withoutSync = { ...provider };
    delete (withoutSync as { sync?: unknown }).sync;
    const { result } = await driveLoop(CWD, { memoryProvider: withoutSync });
    expect(result).toBeDefined();
  });
});
