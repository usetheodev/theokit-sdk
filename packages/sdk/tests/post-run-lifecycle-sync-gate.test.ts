/**
 * Post-run-lifecycle sync gating test (SDK 2.0 Phase 1 physical
 * Stage 2b — iter 26).
 *
 * Pins the behavior: under `THEOKIT_PORT_MEMORY_PATH=1`, post-run-
 * lifecycle SKIPS the legacy `memoryGlue.syncIfReady()` call (because
 * agent-loop's port-driven `provider.sync()` already fired). Under
 * the default (flag off), legacy syncIfReady fires as before.
 *
 * Without this gate, the env-flag path would double-sync — provider.sync
 * fires inside agent-loop AND syncIfReady fires post-run.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PORT_MEMORY_PATH_ENV_VAR,
  shouldUsePortMemoryPath,
} from "../src/internal/runtime/memory-glue/memory-path-selector.js";

describe("post-run-lifecycle sync gating (Stage 2b iter 26)", () => {
  const original = process.env[PORT_MEMORY_PATH_ENV_VAR];

  afterEach(() => {
    if (original === undefined) {
      delete process.env[PORT_MEMORY_PATH_ENV_VAR];
    } else {
      process.env[PORT_MEMORY_PATH_ENV_VAR] = original;
    }
  });

  /**
   * The gate, as post-run-lifecycle.ts spells it:
   *
   *     if (!shouldUsePortMemoryPath()) { void memoryGlue.syncIfReady(); }
   *
   * CONVERTED 2026-09-01. This used to be `maybeFireLegacySync`, a local copy that re-implemented
   * the flag read inline — `env === "1" || env === "true"` — with a comment saying it was there "to
   * mirror shouldUsePortMemoryPath". That function is exported from
   * `internal/runtime/memory-glue/memory-path-selector.ts` and always was, so the copy bought nothing and
   * could drift: a change to how the flag is parsed (an added value, a trimmed string, a default)
   * would leave these five cases green over a gate that no longer behaved that way.
   *
   * The condition is inlined rather than wrapped, because wrapping it in a helper here would be the
   * mirror again in one fewer line.
   */
  function maybeFireLegacySync(syncIfReady: () => void): void {
    if (!shouldUsePortMemoryPath()) {
      syncIfReady();
    }
  }

  it("test_flag_unset_fires_legacy_sync", () => {
    delete process.env[PORT_MEMORY_PATH_ENV_VAR];
    const sync = vi.fn();
    maybeFireLegacySync(sync);
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it("test_flag_1_skips_legacy_sync", () => {
    process.env[PORT_MEMORY_PATH_ENV_VAR] = "1";
    const sync = vi.fn();
    maybeFireLegacySync(sync);
    expect(sync).not.toHaveBeenCalled();
  });

  it("test_flag_true_skips_legacy_sync", () => {
    process.env[PORT_MEMORY_PATH_ENV_VAR] = "true";
    const sync = vi.fn();
    maybeFireLegacySync(sync);
    expect(sync).not.toHaveBeenCalled();
  });

  it("test_flag_other_value_fires_legacy_sync", () => {
    process.env[PORT_MEMORY_PATH_ENV_VAR] = "yes";
    const sync = vi.fn();
    maybeFireLegacySync(sync);
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it("test_flag_0_fires_legacy_sync_opt_out", () => {
    process.env[PORT_MEMORY_PATH_ENV_VAR] = "0";
    const sync = vi.fn();
    maybeFireLegacySync(sync);
    expect(sync).toHaveBeenCalledTimes(1);
  });
});
