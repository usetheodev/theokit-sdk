import { describe, expect, it, vi } from "vitest";

import {
  classifyRound,
  runToCompletionImpl,
} from "../src/internal/runtime/lifecycle/run-to-completion.js";
import type { RunResult } from "../src/types/run.js";

/**
 * M1 Phase 3 (plan m1-run-to-completion) — the continuation driver.
 *
 * The driver re-sends a continuation prompt while a round truncates at the
 * iteration ceiling (`RunResult.stoppedAtIterationLimit`), until a genuine
 * terminal: `done` (finished), `step_limit` (round budget exhausted), or
 * `no_progress` (two consecutive empty rounds). Tested via an injected fake
 * `send` returning a scripted sequence of RunResults — deterministic, no LLM
 * (fixture mode never sets stoppedAtIterationLimit, so injection is the only
 * way to exercise the terminals).
 */
function rr(over: Partial<RunResult> = {}): RunResult {
  return { id: "r", status: "finished", result: "ok", ...over };
}

/** Build a fake agent whose send() yields the scripted results in order. */
function fakeAgent(script: RunResult[]): {
  send: (m: string) => Promise<{ wait: () => Promise<RunResult> }>;
  sends: string[];
} {
  const sends: string[] = [];
  let i = 0;
  return {
    sends,
    send: (m: string) => {
      sends.push(m);
      const result = script[Math.min(i, script.length - 1)] as RunResult;
      i += 1;
      return Promise.resolve({ wait: () => Promise.resolve(result) });
    },
  };
}

describe("classifyRound (pure)", () => {
  it("test_done_when_not_truncated", () => {
    expect(classifyRound(rr({ stoppedAtIterationLimit: false }), 0, 5, 0)).toBe("done");
  });
  it("test_continue_when_truncated_with_budget_left", () => {
    expect(classifyRound(rr({ stoppedAtIterationLimit: true, result: "x" }), 1, 5, 0)).toBe(
      "continue",
    );
  });
  it("test_step_limit_when_truncated_at_maxRounds", () => {
    expect(classifyRound(rr({ stoppedAtIterationLimit: true }), 5, 5, 0)).toBe("step_limit");
  });
  it("test_no_progress_after_second_empty_round", () => {
    // emptyStreak already 1 coming in; this round also empty → no_progress.
    expect(classifyRound(rr({ stoppedAtIterationLimit: true, result: "" }), 1, 5, 1)).toBe(
      "no_progress",
    );
  });
});

describe("runToCompletionImpl", () => {
  it("test_returns_done_when_first_round_not_truncated", async () => {
    const agent = fakeAgent([rr({ stoppedAtIterationLimit: false, result: "final" })]);
    const out = await runToCompletionImpl(agent, "do X");
    expect(out.terminal).toBe("done");
    expect(out.rounds).toBe(0);
    expect(out.lastResult.result).toBe("final");
    expect(agent.sends).toEqual(["do X"]);
  });

  it("test_continues_then_done_and_aggregates_usage", async () => {
    const agent = fakeAgent([
      rr({
        stoppedAtIterationLimit: true,
        result: "partial",
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      }),
      rr({
        stoppedAtIterationLimit: false,
        result: "final",
        usage: { inputTokens: 20, outputTokens: 8, totalTokens: 28 },
      }),
    ]);
    const out = await runToCompletionImpl(agent, "do X", { continuationPrompt: "continue" });
    expect(out.terminal).toBe("done");
    expect(out.rounds).toBe(1);
    expect(agent.sends).toEqual(["do X", "continue"]);
    expect(out.usage?.totalTokens).toBe(43);
    expect(out.usage?.inputTokens).toBe(30);
  });

  it("test_step_limit_when_always_truncating", async () => {
    const agent = fakeAgent([rr({ stoppedAtIterationLimit: true, result: "x" })]);
    const out = await runToCompletionImpl(agent, "do X", { maxRounds: 2 });
    expect(out.terminal).toBe("step_limit");
    expect(out.rounds).toBe(2);
  });

  it("test_no_progress_after_two_empty_rounds", async () => {
    const agent = fakeAgent([rr({ stoppedAtIterationLimit: true, result: "" })]);
    const out = await runToCompletionImpl(agent, "do X", { maxRounds: 9 });
    expect(out.terminal).toBe("no_progress");
  });

  it("test_onTruncated_called_per_truncated_round", async () => {
    const agent = fakeAgent([
      rr({ stoppedAtIterationLimit: true, result: "a" }),
      rr({ stoppedAtIterationLimit: false, result: "done" }),
    ]);
    const onTruncated = vi.fn();
    await runToCompletionImpl(agent, "do X", { onTruncated });
    expect(onTruncated).toHaveBeenCalledTimes(1);
  });

  it("test_abort_signal_stops_between_rounds", async () => {
    const controller = new AbortController();
    const agent = fakeAgent([rr({ stoppedAtIterationLimit: true, result: "x" })]);
    const onTruncated = vi.fn(() => controller.abort());
    const out = await runToCompletionImpl(agent, "do X", {
      maxRounds: 9,
      signal: controller.signal,
      onTruncated,
    });
    // Aborted after round 0; must not keep sending to maxRounds.
    expect(agent.sends.length).toBeLessThan(9);
    expect(out.terminal).toBe("step_limit");
  });
});
