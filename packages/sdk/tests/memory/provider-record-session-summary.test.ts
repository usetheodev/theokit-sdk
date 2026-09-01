/**
 * TYPE-SHAPE assertions for the `recordSessionSummary` port. The WIRING lives elsewhere, on purpose.
 *
 * CONVERTED 2026-09-01. This file used to define `runRecordSessionSummary` — a local copy of the
 * decision in `post-run-lifecycle.ts` — and assert the port-vs-legacy branch against the copy.
 *
 * Measured rather than argued: with `if (memoryProvider?.recordSessionSummary !== undefined)` in
 * production replaced by `if (false)`, so the port is never preferred, this file reported **7 of 7
 * passing** while `post-run-lifecycle-record-session-summary-integration.test.ts` — which drives the
 * real `runPostRunLifecycle` — failed 2 of 5. The four wiring cases here could not fail over the
 * thing they were named for, and the coverage they claimed already existed one file away.
 *
 * So they are gone rather than rewritten: a second driver of the same orchestrator would add a file
 * and no coverage. What remains are the three assertions that are genuinely about the CONTRACT and
 * not the wiring — that `RecordSessionSummaryArgs` carries `cwd`, that the port method is optional
 * on `MemoryProvider`, and that its signature is stateless (one argument, no handle).
 */

import { describe, expect, expectTypeOf, it } from "vitest";
import { resolveMemoryRoot } from "../../src/internal/memory/storage/memory-root.js";
import type { SessionSummaryInput } from "../../src/internal/memory/storage/session-summary-writer.js";
import type {
  MemoryProvider,
  RecordSessionSummaryArgs,
} from "../../src/internal/runtime/memory/memory-provider.js";
import type { MemoryAdapter } from "../../src/types/memory-adapter.js";

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

  it("test_port_args_are_assignable_to_the_real_legacy_writer_input", () => {
    // A THIRD MIRROR LIVED HERE, and it encoded the bug the repository already paid for. The case
    // declared a local `LegacyShape` with `cwd: string` and asserted `RecordSessionSummaryArgs`
    // matched it. The real `SessionSummaryInput` has NO `cwd` — it takes `memoryRoot: MemoryRoot`,
    // and its own docblock says why: *"The RESOLVED memory root, not a cwd — see
    // storage/memory-root.ts (#463)"*. #463 is the defect where the summary was written into a
    // directory the indexer never scanned, precisely because a cwd was used where a resolved root
    // was required. A hand-written copy of the type pinned the confusion as the contract.
    //
    // Asserted against the imported type now, so it cannot say something the type does not.
    const asLegacy: SessionSummaryInput = SUMMARY_ARGS;
    expect(asLegacy.memoryRoot).toBe(SUMMARY_ARGS.memoryRoot);
    expectTypeOf<RecordSessionSummaryArgs>().toMatchTypeOf<SessionSummaryInput>();
  });
});
