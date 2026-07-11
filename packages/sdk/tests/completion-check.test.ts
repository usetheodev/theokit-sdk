import { describe, expect, it, vi } from "vitest";
import type { JudgeResult } from "../src/internal/judge/types.js";
import { wrapRunWithCompletionCheck } from "../src/internal/runtime/lifecycle/wrap-completion-check-run.js";
import type { Run, RunResult } from "../src/types/run.js";
import type { RunEvent } from "../src/types/run-events.js";

/**
 * SE34 (ADR 0013) — the per-send completion check (`isTaskComplete`). Deterministic:
 * the Run + the LLM-judge are both fakes, so no model call happens. Verifies the
 * verdict surfaces on RunResult + a `completion_check` event, the judge runs
 * EXACTLY once, non-finished runs pass through, and a parse failure fails safe.
 */

function fakeRun(result: RunResult): Run {
  // Only `wait` is exercised by the wrapper; the Proxy forwards the rest.
  return {
    id: result.id,
    agentId: "a1",
    status: "finished",
    wait: async () => result,
  } as unknown as Run;
}

const done: JudgeResult = { verdict: "done", reason: "answered the question", parseFailed: false };

describe("SE34 — per-send completion check", () => {
  it("surfaces the verdict on RunResult.completionCheck + emits a completion_check event", async () => {
    const events: RunEvent[] = [];
    const judge = vi.fn(async () => done);
    const wrapped = wrapRunWithCompletionCheck({
      run: fakeRun({ id: "r1", status: "finished", result: "the answer" }),
      completionCheck: { criteria: "does it answer?" },
      onRunEvent: (e) => events.push(e),
      deps: { judge },
    });
    const res = await wrapped.wait();
    expect(res.completionCheck).toEqual({
      complete: true,
      reason: "answered the question",
      parseFailed: false,
    });
    expect(events).toEqual([
      { type: "completion_check", complete: true, reason: "answered the question" },
    ]);
    // The judge saw the final reply as the response and the criteria as the goal.
    expect(judge).toHaveBeenCalledWith({ goal: "does it answer?", lastResponse: "the answer" }, {});
  });

  it("judges EXACTLY once across multiple wait() calls (memoized)", async () => {
    const judge = vi.fn(async () => done);
    const wrapped = wrapRunWithCompletionCheck({
      run: fakeRun({ id: "r1", status: "finished", result: "x" }),
      completionCheck: { criteria: "c" },
      onRunEvent: undefined,
      deps: { judge },
    });
    await wrapped.wait();
    await wrapped.wait();
    expect(judge).toHaveBeenCalledTimes(1);
  });

  it("a 'continue' verdict yields complete: false", async () => {
    const wrapped = wrapRunWithCompletionCheck({
      run: fakeRun({ id: "r1", status: "finished", result: "partial" }),
      completionCheck: { criteria: "c" },
      onRunEvent: undefined,
      deps: { judge: async () => ({ verdict: "continue", reason: "not yet", parseFailed: false }) },
    });
    expect((await wrapped.wait()).completionCheck).toMatchObject({
      complete: false,
      reason: "not yet",
    });
  });

  it("a judge parse failure fails safe (complete: false, parseFailed: true)", async () => {
    const wrapped = wrapRunWithCompletionCheck({
      run: fakeRun({ id: "r1", status: "finished", result: "x" }),
      completionCheck: { criteria: "c" },
      onRunEvent: undefined,
      deps: {
        judge: async () => ({ verdict: "continue", reason: "unparseable", parseFailed: true }),
      },
    });
    expect((await wrapped.wait()).completionCheck).toEqual({
      complete: false,
      reason: "unparseable",
      parseFailed: true,
    });
  });

  it("does NOT judge a non-finished run (passes through untouched)", async () => {
    const judge = vi.fn(async () => done);
    const wrapped = wrapRunWithCompletionCheck({
      run: fakeRun({ id: "r1", status: "error", error: { message: "boom" } } as RunResult),
      completionCheck: { criteria: "c" },
      onRunEvent: undefined,
      deps: { judge },
    });
    const res = await wrapped.wait();
    expect(res.completionCheck).toBeUndefined();
    expect(judge).not.toHaveBeenCalled();
  });

  it("does NOT judge a finished run with no text (tool-only reply, result undefined)", async () => {
    const judge = vi.fn(async () => done);
    const wrapped = wrapRunWithCompletionCheck({
      run: fakeRun({ id: "r1", status: "finished", result: undefined }),
      completionCheck: { criteria: "c" },
      onRunEvent: undefined,
      deps: { judge },
    });
    const res = await wrapped.wait();
    expect(res.completionCheck).toBeUndefined();
    expect(judge).not.toHaveBeenCalled();
  });

  it("returns the run UNCHANGED when no completionCheck is set (opt-in, byte-identical)", async () => {
    const run = fakeRun({ id: "r1", status: "finished", result: "x" });
    const judge = vi.fn(async () => done);
    const wrapped = wrapRunWithCompletionCheck({
      run,
      completionCheck: undefined,
      onRunEvent: undefined,
      deps: { judge },
    });
    expect(wrapped).toBe(run); // same reference — no Proxy wrapping
    expect((await wrapped.wait()).completionCheck).toBeUndefined();
    expect(judge).not.toHaveBeenCalled();
  });

  it("forwards the configured judgeModel + apiKey to the judge", async () => {
    const judge = vi.fn(async () => done);
    const wrapped = wrapRunWithCompletionCheck({
      run: fakeRun({ id: "r1", status: "finished", result: "x" }),
      completionCheck: { criteria: "c", judgeModel: "custom/model", apiKey: "k" },
      onRunEvent: undefined,
      deps: { judge },
    });
    await wrapped.wait();
    expect(judge).toHaveBeenCalledWith(
      { goal: "c", lastResponse: "x" },
      { judgeModel: "custom/model", apiKey: "k" },
    );
  });
});
