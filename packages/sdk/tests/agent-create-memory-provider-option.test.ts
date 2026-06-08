/**
 * Type-level test for the `memoryProvider?` option on `Agent.create`
 * (SDK 2.0 Phase 1 / T1.3 — incremental wiring).
 *
 * Verifies:
 *   - The option exists in `AgentOptions`.
 *   - Accepts a `MemoryProvider` instance (from `createNoopMemoryProvider`
 *     OR any conforming impl).
 *   - Rejects non-provider shapes (TypeScript catches mismatch).
 *
 * Runtime wiring is NOT exercised yet — the agent loop still uses the
 * legacy `Memory` class + `internal/memory/*` runtime files. Pinning the
 * type surface unblocks consumers to adopt the API today + lets the
 * runtime wiring land in T1.4 / T1.5 without breaking the public type.
 *
 * Mirrors `agent-create-budget-tracker-option.test.ts` (Phase 2 / T2.1).
 */

import {
  type AgentOptions,
  createNoopMemoryProvider,
  type MemoryProvider,
} from "@theokit/sdk";
import { describe, expect, expectTypeOf, it } from "vitest";

describe("Agent.create memoryProvider option (Phase 1 type wiring)", () => {
  it("test_agent_options_has_memory_provider_field", () => {
    expectTypeOf<AgentOptions["memoryProvider"]>().toEqualTypeOf<MemoryProvider | undefined>();
  });

  it("test_agent_options_accepts_noop_provider", () => {
    const provider = createNoopMemoryProvider();
    const opts: Partial<AgentOptions> = { memoryProvider: provider };
    expect(opts.memoryProvider).toBeDefined();
    expect(typeof opts.memoryProvider?.init).toBe("function");
    expect(typeof opts.memoryProvider?.buildTools).toBe("function");
    expect(typeof opts.memoryProvider?.runActivePass).toBe("function");
    expect(typeof opts.memoryProvider?.dispose).toBe("function");
  });

  it("test_agent_options_accepts_inline_provider_shape", () => {
    const opts: Partial<AgentOptions> = {
      memoryProvider: {
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
      },
    };
    expect(opts.memoryProvider).toBeDefined();
  });

  it("test_agent_options_rejects_invalid_provider_at_compile_time", () => {
    // @ts-expect-error — missing init / buildTools / runActivePass / dispose.
    const _bad: Partial<AgentOptions> = { memoryProvider: { foo: 1 } };
    void _bad;
  });

  it("test_agent_options_memory_provider_is_optional", () => {
    // Should compile without memoryProvider — pure type assertion.
    const opts: Partial<AgentOptions> = {};
    expect(opts.memoryProvider).toBeUndefined();
  });
});
