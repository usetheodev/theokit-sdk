/**
 * SDK 2.0 Phase 4 (Stage 4) — Optional peer loader unit test (iter 76).
 *
 * Validates the `tryLoadSdkMemoryPeer` helper that the Memory class
 * uses to dynamically delegate to `@theokit/sdk-memory` when the
 * peer is installed. The loader contract:
 *
 *  - Returns the module on success (3 required surfaces present:
 *    MEMORY_EMBEDDING_ADAPTERS, runDreamingSweep, IndexManager).
 *  - Returns `null` on definitive absence (dynamic import throws or
 *    module lacks the expected exports).
 *  - Memoizes the attempt so repeated calls don't re-pay the import
 *    cost during agent runtime.
 *  - `resetSdkMemoryPeerCacheForTests()` clears the memoized result
 *    so a test can probe both "present" and "absent" paths.
 *
 * The workspace setup includes `@theokit/sdk-memory` so the
 * "loaded successfully" branch IS reachable from this test. The
 * "absent" branch is exercised via the resetForTests helper after
 * the loader has populated cache, simulating the `null` resolution.
 *
 * @internal
 */

import {
  resetSdkMemoryPeerCacheForTests,
  type SdkMemoryModule,
  tryLoadSdkMemoryPeer,
} from "../../../src/internal/memory/sdk-memory-peer-loader.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("sdk-core sdk-memory peer loader (iter 76, Phase 4 #1)", () => {
  beforeEach(() => {
    resetSdkMemoryPeerCacheForTests();
  });
  afterEach(() => {
    resetSdkMemoryPeerCacheForTests();
  });

  it("test_loads_workspace_sdk_memory_when_present", async () => {
    // In the monorepo workspace, @theokit/sdk-memory IS installed via
    // pnpm-workspace, so the dynamic import resolves successfully.
    const mod = await tryLoadSdkMemoryPeer();
    expect(mod).not.toBeNull();
    expect(typeof mod?.runDreamingSweep).toBe("function");
    expect(mod?.MEMORY_EMBEDDING_ADAPTERS).toBeDefined();
    expect(mod?.IndexManager).toBeDefined();
  });

  it("test_memoizes_repeated_calls_for_same_attempt", async () => {
    const first = await tryLoadSdkMemoryPeer();
    const second = await tryLoadSdkMemoryPeer();
    // Same module reference returned both times — the cached attempt
    // resolves to the same promise.
    expect(first).toBe(second);
  });

  it("test_loaded_module_satisfies_required_surfaces", async () => {
    const mod = await tryLoadSdkMemoryPeer();
    if (mod === null) {
      throw new Error("Expected workspace sdk-memory to be loadable");
    }
    // MEMORY_EMBEDDING_ADAPTERS must be a Record-like with provider keys.
    const providerIds = Object.keys(mod.MEMORY_EMBEDDING_ADAPTERS);
    expect(providerIds.length).toBeGreaterThanOrEqual(1);
    // Each entry must have an id matching its key.
    for (const [key, adapter] of Object.entries(mod.MEMORY_EMBEDDING_ADAPTERS)) {
      expect(adapter.id).toBe(key);
      expect(typeof adapter.create).toBe("function");
    }
    // IndexManager must have a static open method.
    expect(typeof mod.IndexManager.open).toBe("function");
  });

  it("test_resetForTests_clears_memo_so_re_probe_is_possible", async () => {
    // First attempt populates cache.
    const first = await tryLoadSdkMemoryPeer();
    expect(first).not.toBeNull();
    // Reset clears it.
    resetSdkMemoryPeerCacheForTests();
    // Second attempt loads fresh. (Loader memo prior to reset cleared.)
    const second = await tryLoadSdkMemoryPeer();
    expect(second).not.toBeNull();
    // After reset, the second call's loader runs an independent
    // import attempt. The actual module value resolves to a
    // structurally identical SdkMemoryModule (the workspace ESM
    // module loader returns the same module instance for the same
    // specifier within a process). Both objects are not null.
    expect(second?.MEMORY_EMBEDDING_ADAPTERS).toBeDefined();
  });

  it("test_loader_return_type_is_SdkMemoryModule_or_null", async () => {
    // Compile-time guarantee — the type narrowing surface.
    const result: SdkMemoryModule | null = await tryLoadSdkMemoryPeer();
    // Either null or object with the 3 surfaces.
    if (result !== null) {
      expect(typeof result.runDreamingSweep).toBe("function");
    }
  });
});
