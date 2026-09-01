/**
 * Kernel-flip integration test (SDK 2.0 Phase 1 physical Stage 2b —
 * iter 23).
 *
 * Verifies the env-flag-gated kernel flip works end-to-end:
 *   - `THEOKIT_PORT_MEMORY_PATH=1` → `LocalAgent.sendLocked()` skips
 *     the legacy memoryGlue async calls + injects the auto-installed
 *     adapter into agent-loop inputs.
 *   - Default (flag unset) → legacy path runs unchanged.
 *
 * We don't drive the full agent-loop here (would need stubbed LLM +
 * filesystem). Instead, exercises the SELECTOR CALL CHAIN inside
 * `LocalAgent` via the helpers, mirroring exactly the iter 22
 * `memory/path-selector.test.ts` invariants but composed.
 *
 * The end-to-end behavior (port path actually receiving the adapter)
 * is covered by the per-method wiring tests in agent-loop-memory-
 * provider-*.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLocalAgentMemoryProvider } from "../src/internal/local-agent/local-agent-memory-provider.js";
import {
  PORT_MEMORY_PATH_ENV_VAR,
  resolveActiveMemorySummaryForSend,
  resolveMemoryProviderForLoop,
  resolveMemoryToolsForLoop,
  shouldUsePortMemoryPath,
} from "../src/internal/runtime/memory-glue/memory-path-selector.js";
import type { AgentOptions } from "../src/types/agent.js";

const STUB_OPTIONS: AgentOptions = {
  agentId: "flip-test-agent",
  model: { id: "anthropic/claude-3-5-haiku-latest" },
} as AgentOptions;

describe("LocalAgent port-memory-path kernel flip (Stage 2b iter 23)", () => {
  const original = process.env[PORT_MEMORY_PATH_ENV_VAR];

  afterEach(() => {
    if (original === undefined) {
      delete process.env[PORT_MEMORY_PATH_ENV_VAR];
    } else {
      process.env[PORT_MEMORY_PATH_ENV_VAR] = original;
    }
  });

  describe("flag unset (default — legacy path)", () => {
    beforeEach(() => {
      delete process.env[PORT_MEMORY_PATH_ENV_VAR];
    });

    it("test_shouldUsePortMemoryPath_returns_false", () => {
      expect(shouldUsePortMemoryPath()).toBe(false);
    });

    it("test_memoryTools_passed_through_unchanged_legacy", () => {
      const legacyTools = [
        {
          name: "memory_search",
          description: "x",
          inputSchema: { type: "object" },
          execute: async () => "{}",
        },
      ];
      const portPathActive = shouldUsePortMemoryPath();
      const tools = resolveMemoryToolsForLoop(legacyTools, portPathActive);
      expect(tools).toBe(legacyTools); // identity preserved
    });

    it("test_activeMemorySummary_passed_through_unchanged_legacy", () => {
      const legacySummary = "User prefers TypeScript.";
      const portPathActive = shouldUsePortMemoryPath();
      const summary = resolveActiveMemorySummaryForSend(legacySummary, portPathActive);
      expect(summary).toBe(legacySummary);
    });

    it("test_memoryProvider_resolves_to_undefined_when_consumer_didnt_supply", () => {
      const defaultAdapter = createLocalAgentMemoryProvider({
        agentOptions: STUB_OPTIONS,
        workspaceCwd: "/tmp/flip",
        agentId: "flip-test-agent",
      });
      const portPathActive = shouldUsePortMemoryPath();
      const provider = resolveMemoryProviderForLoop(undefined, defaultAdapter, portPathActive);
      expect(provider).toBeUndefined();
    });
  });

  describe("flag set (port path active)", () => {
    beforeEach(() => {
      process.env[PORT_MEMORY_PATH_ENV_VAR] = "1";
    });

    it("test_shouldUsePortMemoryPath_returns_true", () => {
      expect(shouldUsePortMemoryPath()).toBe(true);
    });

    it("test_memoryTools_suppressed_in_port_path", () => {
      const legacyTools = [
        {
          name: "memory_search",
          description: "x",
          inputSchema: { type: "object" },
          execute: async () => "{}",
        },
      ];
      const portPathActive = shouldUsePortMemoryPath();
      const tools = resolveMemoryToolsForLoop(legacyTools, portPathActive);
      expect(tools).toBeUndefined(); // suppressed
    });

    it("test_activeMemorySummary_suppressed_in_port_path", () => {
      const legacySummary = "User prefers TypeScript.";
      const portPathActive = shouldUsePortMemoryPath();
      const summary = resolveActiveMemorySummaryForSend(legacySummary, portPathActive);
      expect(summary).toBeUndefined();
    });

    it("test_memoryProvider_resolves_to_default_adapter_when_consumer_didnt_supply", () => {
      const defaultAdapter = createLocalAgentMemoryProvider({
        agentOptions: STUB_OPTIONS,
        workspaceCwd: "/tmp/flip",
        agentId: "flip-test-agent",
      });
      const portPathActive = shouldUsePortMemoryPath();
      const provider = resolveMemoryProviderForLoop(undefined, defaultAdapter, portPathActive);
      expect(provider).toBe(defaultAdapter);
    });

    it("test_consumer_supplied_memoryProvider_still_wins_when_flag_set", () => {
      // Consumer-supplied provider has highest precedence regardless of flag.
      const consumerProvider = createLocalAgentMemoryProvider({
        agentOptions: STUB_OPTIONS,
        workspaceCwd: "/tmp/flip",
        agentId: "consumer-agent",
      });
      const defaultAdapter = createLocalAgentMemoryProvider({
        agentOptions: STUB_OPTIONS,
        workspaceCwd: "/tmp/flip",
        agentId: "default-agent",
      });
      const portPathActive = shouldUsePortMemoryPath();
      const provider = resolveMemoryProviderForLoop(
        consumerProvider,
        defaultAdapter,
        portPathActive,
      );
      expect(provider).toBe(consumerProvider);
    });
  });
});
