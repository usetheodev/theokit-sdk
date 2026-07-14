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
  it("test_no_progress_beats_step_limit_at_boundary", () => {
    // Empty + prior empty AND at the round budget: no_progress wins (more actionable).
    expect(classifyRound(rr({ stoppedAtIterationLimit: true, result: "" }), 5, 5, 1)).toBe(
      "no_progress",
    );
  });
  it("test_classifyRound_doom_loop_returns_no_progress", () => {
    // A doom-loop stop is a genuine terminal — not a truncation to continue.
    expect(classifyRound(rr({ stoppedByDoomLoop: true, result: "stopped" }), 0, 5, 0)).toBe(
      "no_progress",
    );
  });
  it("test_classifyRound_doom_loop_stops_below_maxRounds", () => {
    // Even with rounds/budget left, a doom-loop stop does NOT re-send.
    expect(classifyRound(rr({ stoppedByDoomLoop: true, result: "stopped" }), 0, 5, 0)).not.toBe(
      "continue",
    );
  });
  it("test_classifyRound_doom_loop_wins_over_iteration_limit (EC-2)", () => {
    // Both flags set → the doom-loop branch precedes the iteration-limit check → "no_progress".
    expect(
      classifyRound(rr({ stoppedByDoomLoop: true, stoppedAtIterationLimit: true }), 1, 5, 0),
    ).toBe("no_progress");
  });
  it("test_non_empty_at_budget_is_step_limit_not_no_progress", () => {
    // Made progress (non-empty) but ran out of rounds → step_limit, even with prior empty.
    expect(classifyRound(rr({ stoppedAtIterationLimit: true, result: "x" }), 5, 5, 1)).toBe(
      "step_limit",
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

  it("test_end_to_end_doom_loop_terminates_no_progress", async () => {
    // A run that doom-loop-stopped surfaces `stoppedByDoomLoop`; the driver terminates immediately
    // with `no_progress` and does NOT re-send (rounds 0), even with maxRounds budget left.
    const agent = fakeAgent([rr({ stoppedByDoomLoop: true, result: "Stopped: repeated calls." })]);
    const out = await runToCompletionImpl(agent, "do X", { maxRounds: 9 });
    expect(out.terminal).toBe("no_progress");
    expect(out.rounds).toBe(0);
    expect(agent.sends).toEqual(["do X"]); // no continuation re-send
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
    // Aborted in round-0's onTruncated → exactly one send, stops precisely there
    // (distinct from a maxRounds=9 budget exhaustion, which would send 10×).
    expect(agent.sends).toEqual(["do X"]);
    expect(out.rounds).toBe(0);
    expect(out.terminal).toBe("step_limit");
  });

  it("test_usage_undefined_when_no_round_reports_usage", async () => {
    const agent = fakeAgent([rr({ stoppedAtIterationLimit: false, result: "final" })]);
    const out = await runToCompletionImpl(agent, "do X");
    expect(out.usage).toBeUndefined();
    expect("usage" in out).toBe(false);
  });

  it("test_usage_totalTokens_is_derived_not_summed", async () => {
    // EC-10: a provider folds reasoning into totalTokens (total > in+out). The
    // driver must re-derive total = Σin + Σout, never propagate the inconsistency.
    const agent = fakeAgent([
      rr({
        stoppedAtIterationLimit: true,
        result: "p",
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 99, reasoningTokens: 84 },
      }),
      rr({
        stoppedAtIterationLimit: false,
        result: "final",
        usage: { inputTokens: 20, outputTokens: 8, totalTokens: 50, reasoningTokens: 22 },
      }),
    ]);
    const out = await runToCompletionImpl(agent, "do X");
    expect(out.usage?.inputTokens).toBe(30);
    expect(out.usage?.outputTokens).toBe(13);
    expect(out.usage?.totalTokens).toBe(43); // 30 + 13, NOT 99 + 50
    expect(out.usage?.reasoningTokens).toBe(106); // optional buckets still sum
  });

  it("test_default_continuation_prompt_used_when_unset", async () => {
    const agent = fakeAgent([
      rr({ stoppedAtIterationLimit: true, result: "p" }),
      rr({ stoppedAtIterationLimit: false, result: "final" }),
    ]);
    const out = await runToCompletionImpl(agent, "do X");
    expect(out.terminal).toBe("done");
    expect(agent.sends[0]).toBe("do X");
    // round-1 prompt is the built-in default, distinct from the original message.
    expect(agent.sends[1]).not.toBe("do X");
    expect((agent.sends[1] ?? "").length).toBeGreaterThan(0);
  });

  it("test_maxRounds_zero_step_limits_on_first_truncation", async () => {
    const agent = fakeAgent([rr({ stoppedAtIterationLimit: true, result: "x" })]);
    const out = await runToCompletionImpl(agent, "do X", { maxRounds: 0 });
    expect(out.terminal).toBe("step_limit");
    expect(out.rounds).toBe(0);
    expect(agent.sends).toEqual(["do X"]);
  });
});

describe("SE3 — auto-continuation provenance", () => {
  it("stamps origin {kind:'auto-continuation'} on continuation rounds only", async () => {
    const opts: Array<{ origin?: { kind: string } } | undefined> = [];
    const script = [
      rr({ stoppedAtIterationLimit: true, result: "part" }), // round 0 → continue
      rr({ stoppedAtIterationLimit: false, result: "done" }), // round 1 → done
    ];
    let i = 0;
    const agent = {
      send: (_m: string, o?: { origin?: { kind: string } }) => {
        opts.push(o);
        const result = script[Math.min(i, script.length - 1)] as RunResult;
        i += 1;
        return Promise.resolve({ wait: () => Promise.resolve(result) });
      },
    };
    await runToCompletionImpl(agent as never, "go", { maxRounds: 5 });
    expect(opts[0]?.origin).toBeUndefined(); // first send = caller's turn
    expect(opts[1]?.origin).toEqual({ kind: "auto-continuation" });
  });
});
