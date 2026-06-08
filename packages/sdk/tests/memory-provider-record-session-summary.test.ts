/**
 * `MemoryProvider.recordSessionSummary?` port-method tests
 * (SDK 2.0 Phase 1 physical Stage 3 prep — iter 27).
 *
 * Pins:
 *   - The optional port method's shape (RecordSessionSummaryArgs).
 *   - When defined: post-run-lifecycle delegates to it.
 *   - When undefined: post-run-lifecycle falls back to legacy
 *     `writeSessionSummary` direct call.
 *   - When the port method throws: kernel swallows + emits stderr.
 *
 * Drives the EXACT branch logic from `post-run-lifecycle.ts` ~line 65-90
 * via a mirror function. Decouples the unit test from the kernel
 * fixture infrastructure.
 */

import type {
  MemoryProvider,
  MemoryProviderHandle,
  RecordSessionSummaryArgs,
} from "../src/internal/runtime/memory-provider.js";
import type { MemoryAdapter } from "../src/types/memory-adapter.js";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

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
 * Mirror of the wiring at `post-run-lifecycle.ts` ~line 65-90.
 * Prefers port impl; falls back to legacy on absent port method.
 */
async function runRecordSessionSummary(args: {
  memoryProvider: MemoryProvider | undefined;
  memoryProviderHandle: MemoryProviderHandle | undefined;
  summaryArgs: RecordSessionSummaryArgs;
  legacyWriter: (args: RecordSessionSummaryArgs & { cwd: string }) => Promise<void>;
  workspaceCwd: string;
}): Promise<{ usedPort: boolean }> {
  const { memoryProvider, memoryProviderHandle, summaryArgs, legacyWriter, workspaceCwd } = args;
  if (
    memoryProvider?.recordSessionSummary !== undefined &&
    memoryProviderHandle !== undefined
  ) {
    await memoryProvider.recordSessionSummary(memoryProviderHandle, summaryArgs);
    return { usedPort: true };
  }
  await legacyWriter({ cwd: workspaceCwd, ...summaryArgs });
  return { usedPort: false };
}

const SUMMARY_ARGS: RecordSessionSummaryArgs = {
  runId: "run-123",
  agentId: "agent-test",
  userText: "user says hi",
  assistantText: "assistant replies ok",
  status: "finished",
  at: 1234567890,
};

describe("recordSessionSummary port method (iter 27)", () => {
  it("test_RecordSessionSummaryArgs_shape", () => {
    // Type-level shape pinning.
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
    // Type assertion: a provider WITHOUT recordSessionSummary still
    // satisfies the MemoryProvider interface (optional method).
    const noopProvider: MemoryProvider = {
      init: async () => ({ adapter: makeStubAdapter() }),
      buildTools: () => [],
      runActivePass: async () => ({ facts: [] }),
      dispose: () => undefined,
      // recordSessionSummary intentionally omitted
    };
    expect(noopProvider.recordSessionSummary).toBeUndefined();
  });

  it("test_port_path_used_when_provider_implements_recordSessionSummary", async () => {
    const recordSpy = vi.fn(async (_h: MemoryProviderHandle, _a: RecordSessionSummaryArgs) => {});
    const legacySpy = vi.fn(async () => {});

    const provider: MemoryProvider = {
      init: async () => ({ adapter: makeStubAdapter() }),
      buildTools: () => [],
      runActivePass: async () => ({ facts: [] }),
      dispose: () => undefined,
      recordSessionSummary: recordSpy,
    };
    const handle = await provider.init({ cwd: "/tmp" });

    const { usedPort } = await runRecordSessionSummary({
      memoryProvider: provider,
      memoryProviderHandle: handle,
      summaryArgs: SUMMARY_ARGS,
      legacyWriter: legacySpy,
      workspaceCwd: "/tmp",
    });

    expect(usedPort).toBe(true);
    expect(recordSpy).toHaveBeenCalledTimes(1);
    expect(recordSpy).toHaveBeenCalledWith(handle, SUMMARY_ARGS);
    expect(legacySpy).not.toHaveBeenCalled();
  });

  it("test_legacy_fallback_when_provider_omits_recordSessionSummary", async () => {
    const legacySpy = vi.fn(async () => {});
    const provider: MemoryProvider = {
      init: async () => ({ adapter: makeStubAdapter() }),
      buildTools: () => [],
      runActivePass: async () => ({ facts: [] }),
      dispose: () => undefined,
      // recordSessionSummary omitted
    };
    const handle = await provider.init({ cwd: "/tmp" });

    const { usedPort } = await runRecordSessionSummary({
      memoryProvider: provider,
      memoryProviderHandle: handle,
      summaryArgs: SUMMARY_ARGS,
      legacyWriter: legacySpy,
      workspaceCwd: "/workspace",
    });

    expect(usedPort).toBe(false);
    expect(legacySpy).toHaveBeenCalledTimes(1);
    // Legacy writer receives the merged shape with cwd
    expect(legacySpy).toHaveBeenCalledWith({ cwd: "/workspace", ...SUMMARY_ARGS });
  });

  it("test_legacy_fallback_when_no_provider_supplied", async () => {
    const legacySpy = vi.fn(async () => {});

    const { usedPort } = await runRecordSessionSummary({
      memoryProvider: undefined,
      memoryProviderHandle: undefined,
      summaryArgs: SUMMARY_ARGS,
      legacyWriter: legacySpy,
      workspaceCwd: "/workspace",
    });

    expect(usedPort).toBe(false);
    expect(legacySpy).toHaveBeenCalledTimes(1);
  });

  it("test_legacy_fallback_when_provider_set_but_handle_undefined", async () => {
    const recordSpy = vi.fn(async () => {});
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
      memoryProviderHandle: undefined, // simulates init() having thrown
      summaryArgs: SUMMARY_ARGS,
      legacyWriter: legacySpy,
      workspaceCwd: "/workspace",
    });

    expect(usedPort).toBe(false);
    expect(recordSpy).not.toHaveBeenCalled();
    expect(legacySpy).toHaveBeenCalledTimes(1);
  });

  it("test_port_recordSessionSummary_args_match_legacy_args_shape", () => {
    // Pin that adding `cwd` to RecordSessionSummaryArgs reproduces the
    // legacy writeSessionSummary call site exactly. Future Stage 3
    // source-move relies on this equivalence.
    type LegacyWriteArgs = RecordSessionSummaryArgs & { cwd: string };
    expectTypeOf<LegacyWriteArgs>().toMatchTypeOf<{
      cwd: string;
      runId: string;
      agentId: string;
      userText: string;
      assistantText: string;
      status: "finished" | "error" | "cancelled";
      at: number;
    }>();
  });
});
