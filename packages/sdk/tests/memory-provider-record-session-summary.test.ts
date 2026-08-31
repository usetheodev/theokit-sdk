/**
 * `MemoryProvider.recordSessionSummary?` port-method tests
 * (SDK 2.0 Phase 1 physical Stage 3 prep — iter 27, refined iter 28).
 *
 * STATELESS — port method takes args only (NO handle), because
 * post-run-lifecycle runs AFTER runAgentLoop disposes the per-run
 * handle. `cwd` lives on the args.
 *
 * Pins:
 *   - The optional port method's shape (RecordSessionSummaryArgs incl. cwd).
 *   - When defined: post-run-lifecycle delegates to it.
 *   - When undefined: post-run-lifecycle falls back to legacy
 *     `writeSessionSummary` direct call.
 */

import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { resolveMemoryRoot } from "../src/internal/memory/storage/memory-root.js";
import type {
  MemoryProvider,
  RecordSessionSummaryArgs,
} from "../src/internal/runtime/memory/memory-provider.js";
import type { MemoryAdapter } from "../src/types/memory-adapter.js";

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
 * Mirror of the wiring at `post-run-lifecycle.ts` ~line 70-90.
 * Prefers stateless port impl; falls back to legacy on absent port method.
 */
async function runRecordSessionSummary(args: {
  memoryProvider: MemoryProvider | undefined;
  summaryArgs: RecordSessionSummaryArgs;
  legacyWriter: (args: RecordSessionSummaryArgs) => Promise<void>;
}): Promise<{ usedPort: boolean }> {
  const { memoryProvider, summaryArgs, legacyWriter } = args;
  if (memoryProvider?.recordSessionSummary !== undefined) {
    await memoryProvider.recordSessionSummary(summaryArgs);
    return { usedPort: true };
  }
  await legacyWriter(summaryArgs);
  return { usedPort: false };
}

const SUMMARY_ARGS: RecordSessionSummaryArgs = {
  cwd: "/workspace",
  memoryRoot: resolveMemoryRoot("/workspace"),
  runId: "run-123",
  agentId: "agent-test",
  userText: "user says hi",
  assistantText: "assistant replies ok",
  status: "finished",
  at: 1234567890,
};

describe("recordSessionSummary port method — STATELESS (iter 27/28)", () => {
  it("test_RecordSessionSummaryArgs_shape_includes_cwd", () => {
    // Type-level shape pinning — cwd is on args (not on handle).
    expectTypeOf<RecordSessionSummaryArgs["cwd"]>().toEqualTypeOf<string>();
    expectTypeOf<RecordSessionSummaryArgs["runId"]>().toEqualTypeOf<string>();
    expectTypeOf<RecordSessionSummaryArgs["agentId"]>().toEqualTypeOf<string>();
    expectTypeOf<RecordSessionSummaryArgs["userText"]>().toEqualTypeOf<string>();
    expectTypeOf<RecordSessionSummaryArgs["assistantText"]>().toEqualTypeOf<string>();
    expectTypeOf<RecordSessionSummaryArgs["status"]>().toEqualTypeOf<
      "finished" | "error" | "cancelled"
    >();
    expectTypeOf<RecordSessionSummaryArgs["at"]>().toEqualTypeOf<number>();
  });

  it("test_port_recordSessionSummary_is_optional_on_MemoryProvider", () => {
    const noopProvider: MemoryProvider = {
      init: async () => ({ adapter: makeStubAdapter() }),
      buildTools: () => [],
      runActivePass: async () => ({ facts: [] }),
      dispose: () => undefined,
    };
    expect(noopProvider.recordSessionSummary).toBeUndefined();
  });

  it("test_port_method_signature_is_stateless_one_arg", () => {
    // Pin: signature is `(args: RecordSessionSummaryArgs) => Promise<void> | void`.
    // NO handle param (post-run-lifecycle has no handle by the time it
    // calls this — runAgentLoop already disposed).
    expectTypeOf<NonNullable<MemoryProvider["recordSessionSummary"]>>()
      .parameter(0)
      .toEqualTypeOf<RecordSessionSummaryArgs>();
    // Verify the function has exactly ONE parameter (no second-arg overload).
    expectTypeOf<NonNullable<MemoryProvider["recordSessionSummary"]>>().parameters.toEqualTypeOf<
      [RecordSessionSummaryArgs]
    >();
  });

  it("test_port_path_used_when_provider_implements_recordSessionSummary", async () => {
    const recordSpy = vi.fn(async (_a: RecordSessionSummaryArgs) => {});
    const legacySpy = vi.fn(async () => {});

    const provider: MemoryProvider = {
      init: async () => ({ adapter: makeStubAdapter() }),
      buildTools: () => [],
      runActivePass: async () => ({ facts: [] }),
      dispose: () => undefined,
      recordSessionSummary: recordSpy,
    };

    const { usedPort } = await runRecordSessionSummary({
      memoryProvider: provider,
      summaryArgs: SUMMARY_ARGS,
      legacyWriter: legacySpy,
    });

    expect(usedPort).toBe(true);
    expect(recordSpy).toHaveBeenCalledTimes(1);
    expect(recordSpy).toHaveBeenCalledWith(SUMMARY_ARGS);
    expect(legacySpy).not.toHaveBeenCalled();
  });

  it("test_legacy_fallback_when_provider_omits_recordSessionSummary", async () => {
    const legacySpy = vi.fn(async () => {});
    const provider: MemoryProvider = {
      init: async () => ({ adapter: makeStubAdapter() }),
      buildTools: () => [],
      runActivePass: async () => ({ facts: [] }),
      dispose: () => undefined,
    };

    const { usedPort } = await runRecordSessionSummary({
      memoryProvider: provider,
      summaryArgs: SUMMARY_ARGS,
      legacyWriter: legacySpy,
    });

    expect(usedPort).toBe(false);
    expect(legacySpy).toHaveBeenCalledTimes(1);
    expect(legacySpy).toHaveBeenCalledWith(SUMMARY_ARGS);
  });

  it("test_legacy_fallback_when_no_provider_supplied", async () => {
    const legacySpy = vi.fn(async () => {});

    const { usedPort } = await runRecordSessionSummary({
      memoryProvider: undefined,
      summaryArgs: SUMMARY_ARGS,
      legacyWriter: legacySpy,
    });

    expect(usedPort).toBe(false);
    expect(legacySpy).toHaveBeenCalledTimes(1);
  });

  it("test_port_args_compatible_with_legacy_SessionSummaryInput", () => {
    // The legacy writeSessionSummary's SessionSummaryInput type is a
    // SUPERSET of RecordSessionSummaryArgs (status union includes
    // "running" which port doesn't need). This compatibility is what
    // lets post-run-lifecycle pass `summaryArgs` to both paths.
    type LegacyShape = {
      cwd: string;
      runId: string;
      agentId: string;
      userText: string;
      assistantText: string;
      status: "finished" | "running" | "error" | "cancelled";
      at: number;
    };
    // RecordSessionSummaryArgs is assignable to LegacyShape (subtype).
    expectTypeOf<RecordSessionSummaryArgs>().toMatchTypeOf<LegacyShape>();
  });
});
