/**
 * `memory-path-selector` helper tests (SDK 2.0 Phase 1 physical Stage
 * 2b — iter 22).
 *
 * Pins the env-flag semantics + selector logic. Future kernel flip
 * (`LocalAgent.send()` refactor) wires these helpers; pre-shipping
 * + freezing the contract here de-risks the actual refactor.
 */

import { afterEach, describe, expect, it } from "vitest";
import type { MemoryToolSpec } from "../../src/internal/agent-loop/types.js";
import {
  PORT_MEMORY_PATH_ENV_VAR,
  resolveActiveMemorySummaryForSend,
  resolveMemoryProviderForLoop,
  resolveMemoryToolsForLoop,
  shouldUsePortMemoryPath,
} from "../../src/internal/runtime/memory/memory-path-selector.js";
import type { MemoryProvider } from "../../src/internal/runtime/memory/memory-provider.js";

const STUB_PROVIDER: MemoryProvider = {
  init: async () => ({
    adapter: {
      id: "stub",
      capabilities: {
        history: false,
        sessions: false,
        tenancy: false,
        reasoning: false,
        toolSchemas: false,
        prefetch: false,
      },
      isAvailable: () => true,
      write: async () => "stub:noop" as never,
      recall: async () => [],
      delete: async () => undefined,
    },
  }),
  buildTools: () => [],
  runActivePass: async () => ({ facts: [] }),
  dispose: () => undefined,
};

const STUB_DEFAULT_ADAPTER: MemoryProvider = {
  init: async () => ({
    adapter: {
      id: "adapter",
      capabilities: {
        history: false,
        sessions: false,
        tenancy: false,
        reasoning: false,
        toolSchemas: false,
        prefetch: false,
      },
      isAvailable: () => true,
      write: async () => "adapter:noop" as never,
      recall: async () => [],
      delete: async () => undefined,
    },
  }),
  buildTools: () => [],
  runActivePass: async () => ({ facts: [] }),
  dispose: () => undefined,
};

describe("shouldUsePortMemoryPath (env-flag gate)", () => {
  const original = process.env[PORT_MEMORY_PATH_ENV_VAR];

  afterEach(() => {
    if (original === undefined) {
      delete process.env[PORT_MEMORY_PATH_ENV_VAR];
    } else {
      process.env[PORT_MEMORY_PATH_ENV_VAR] = original;
    }
  });

  it("test_env_var_unset_returns_false", () => {
    delete process.env[PORT_MEMORY_PATH_ENV_VAR];
    expect(shouldUsePortMemoryPath()).toBe(false);
  });

  it("test_env_var_1_returns_true", () => {
    process.env[PORT_MEMORY_PATH_ENV_VAR] = "1";
    expect(shouldUsePortMemoryPath()).toBe(true);
  });

  it("test_env_var_true_returns_true", () => {
    process.env[PORT_MEMORY_PATH_ENV_VAR] = "true";
    expect(shouldUsePortMemoryPath()).toBe(true);
  });

  it("test_env_var_other_value_returns_false", () => {
    process.env[PORT_MEMORY_PATH_ENV_VAR] = "yes";
    expect(shouldUsePortMemoryPath()).toBe(false);
    process.env[PORT_MEMORY_PATH_ENV_VAR] = "0";
    expect(shouldUsePortMemoryPath()).toBe(false);
    process.env[PORT_MEMORY_PATH_ENV_VAR] = "";
    expect(shouldUsePortMemoryPath()).toBe(false);
  });
});

describe("resolveMemoryProviderForLoop (provider selection)", () => {
  it("test_consumer_supplied_always_wins_regardless_of_flag", () => {
    // Flag OFF: consumer wins
    expect(resolveMemoryProviderForLoop(STUB_PROVIDER, STUB_DEFAULT_ADAPTER, false)).toBe(
      STUB_PROVIDER,
    );
    // Flag ON: consumer still wins
    expect(resolveMemoryProviderForLoop(STUB_PROVIDER, STUB_DEFAULT_ADAPTER, true)).toBe(
      STUB_PROVIDER,
    );
  });

  it("test_no_consumer_flag_off_returns_undefined", () => {
    expect(resolveMemoryProviderForLoop(undefined, STUB_DEFAULT_ADAPTER, false)).toBeUndefined();
  });

  it("test_no_consumer_flag_on_returns_default_adapter", () => {
    expect(resolveMemoryProviderForLoop(undefined, STUB_DEFAULT_ADAPTER, true)).toBe(
      STUB_DEFAULT_ADAPTER,
    );
  });
});

describe("resolveMemoryToolsForLoop (legacy tools selection)", () => {
  const LEGACY_TOOLS: ReadonlyArray<MemoryToolSpec> = [
    {
      name: "memory_search",
      description: "Search memory",
      inputSchema: { type: "object" },
      execute: async () => "{}",
    },
  ];

  it("test_flag_off_returns_legacy_tools", () => {
    expect(resolveMemoryToolsForLoop(LEGACY_TOOLS, false)).toBe(LEGACY_TOOLS);
  });

  it("test_flag_on_suppresses_legacy_tools", () => {
    expect(resolveMemoryToolsForLoop(LEGACY_TOOLS, true)).toBeUndefined();
  });

  it("test_flag_off_legacy_undefined_passes_through", () => {
    expect(resolveMemoryToolsForLoop(undefined, false)).toBeUndefined();
  });
});

describe("resolveActiveMemorySummaryForSend (legacy summary selection)", () => {
  it("test_flag_off_returns_legacy_summary", () => {
    expect(resolveActiveMemorySummaryForSend("user prefers X", false)).toBe("user prefers X");
  });

  it("test_flag_on_suppresses_legacy_summary", () => {
    expect(resolveActiveMemorySummaryForSend("user prefers X", true)).toBeUndefined();
  });

  it("test_flag_off_legacy_undefined_passes_through", () => {
    expect(resolveActiveMemorySummaryForSend(undefined, false)).toBeUndefined();
  });
});

describe("PORT_MEMORY_PATH_ENV_VAR (constant invariant)", () => {
  it("test_constant_matches_documented_name", () => {
    // Pin the env-var name so a future rename doesn't silently break
    // ops who set the var in CI.
    expect(PORT_MEMORY_PATH_ENV_VAR).toBe("THEOKIT_PORT_MEMORY_PATH");
  });
});
