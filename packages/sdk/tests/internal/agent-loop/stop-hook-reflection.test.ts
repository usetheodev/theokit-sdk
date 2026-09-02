import { describe, expect, it, vi } from "vitest";

import {
  continueOrTerminate,
  MAX_STOP_FEEDBACK_ATTEMPTS,
  reflectAfterStop,
} from "../../../src/internal/agent-loop/loop.js";
import type { LoopContext } from "../../../src/internal/agent-loop/loop-context-init.js";
import type { AgentLoopInputs } from "../../../src/internal/agent-loop/types.js";
import type { HookExecutionResult } from "../../../src/internal/runtime/hooks/hooks-executor.js";

/**
 * M1-4 — fire the `stop` hook at the clean-finish terminal + honor a
 * `decision:"feedback"` as a BOUNDED in-loop re-prompt (reflection ladder).
 * Driven by a fake `inputs.hooks.run` — deterministic, no LLM. Design: blueprint
 * m1-stop-hook-reflection ADRs D1-D3.
 */

type RunFn = (payload: { event: string }) => Promise<HookExecutionResult>;

function makeInputs(run: RunFn): AgentLoopInputs {
  return { agentId: "agent-x", runId: "run-1", hooks: { run } } as unknown as AgentLoopInputs;
}
function makeCtx(): LoopContext {
  return { messages: [], stopFeedbackAttempts: 0 } as unknown as LoopContext;
}
function decisions(...ds: Array<{ decision: string; feedback?: string }>): HookExecutionResult {
  return { decisions: ds, blocked: ds.some((d) => d.decision === "deny") } as HookExecutionResult;
}

describe("reflectAfterStop (M1-4)", () => {
  it("test_fires_stop_hook_on_clean_finish", async () => {
    const run = vi.fn<RunFn>(async () => decisions({ decision: "allow" }));
    await reflectAfterStop(makeInputs(run), makeCtx());
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[0]).toMatchObject({ event: "stop" });
  });

  it("test_feedback_decision_reprompts_and_pushes_user_message", async () => {
    const run = vi.fn<RunFn>(async () =>
      decisions({ decision: "feedback", feedback: "keep going" }),
    );
    const ctx = makeCtx();
    const cont = await reflectAfterStop(makeInputs(run), ctx);
    expect(cont).toBe(true);
    expect(ctx.stopFeedbackAttempts).toBe(1);
    const last = ctx.messages.at(-1);
    expect(last?.role).toBe("user");
    expect(JSON.stringify(last?.content)).toContain("keep going");
  });

  it("test_reflection_is_bounded_by_ceiling", async () => {
    const run = vi.fn<RunFn>(async () => decisions({ decision: "feedback", feedback: "again" }));
    const inputs = makeInputs(run);
    const ctx = makeCtx();
    let continued = 0;
    const calls = MAX_STOP_FEEDBACK_ATTEMPTS + 3;
    // Drive reflection repeatedly; it must re-prompt at most MAX times, then finish.
    for (let i = 0; i < calls; i += 1) {
      if (await reflectAfterStop(inputs, ctx)) continued += 1;
    }
    expect(continued).toBe(MAX_STOP_FEEDBACK_ATTEMPTS);
    expect(ctx.stopFeedbackAttempts).toBe(MAX_STOP_FEEDBACK_ATTEMPTS);
    // F1: the stop hook still FIRES on every clean finish (observer sees the
    // terminal even at the ceiling) — the ceiling gates re-prompting, not firing.
    expect(run).toHaveBeenCalledTimes(calls);
  });

  it("test_allow_decision_finishes_normally", async () => {
    const run = vi.fn<RunFn>(async () => decisions({ decision: "allow" }));
    const ctx = makeCtx();
    const cont = await reflectAfterStop(makeInputs(run), ctx);
    expect(cont).toBe(false);
    expect(ctx.messages.length).toBe(0);
  });

  it("test_no_stop_hook_finishes_normally", async () => {
    const run = vi.fn<RunFn>(async () => decisions()); // no decisions registered
    const ctx = makeCtx();
    expect(await reflectAfterStop(makeInputs(run), ctx)).toBe(false);
    expect(ctx.messages.length).toBe(0);
  });

  it("test_deny_at_stop_finishes_normally", async () => {
    const run = vi.fn<RunFn>(async () => decisions({ decision: "deny" }));
    const ctx = makeCtx();
    expect(await reflectAfterStop(makeInputs(run), ctx)).toBe(false);
    expect(ctx.messages.length).toBe(0);
  });

  it("test_stopFeedbackAttempts_increments_only_on_feedback", async () => {
    // EC-1: allow does not bump the counter; only an honored feedback does.
    const allow = makeCtx();
    await reflectAfterStop(
      makeInputs(async () => decisions({ decision: "allow" })),
      allow,
    );
    expect(allow.stopFeedbackAttempts).toBe(0);
    const fb = makeCtx();
    await reflectAfterStop(
      makeInputs(async () => decisions({ decision: "feedback", feedback: "x" })),
      fb,
    );
    expect(fb.stopFeedbackAttempts).toBe(1);
  });

  it("test_empty_feedback_string_is_ignored", async () => {
    const run = vi.fn<RunFn>(async () => decisions({ decision: "feedback", feedback: "" }));
    const ctx = makeCtx();
    expect(await reflectAfterStop(makeInputs(run), ctx)).toBe(false);
    expect(ctx.stopFeedbackAttempts).toBe(0);
  });

  it("test_deny_is_authoritative_even_when_feedback_precedes_it", async () => {
    // F3: a deny short-circuits the executor (blocked) even if a feedback decision
    // was emitted first — deny must win regardless of hook ordering → finish.
    const run = vi.fn<RunFn>(async () =>
      decisions({ decision: "feedback", feedback: "go" }, { decision: "deny" }),
    );
    const ctx = makeCtx();
    expect(await reflectAfterStop(makeInputs(run), ctx)).toBe(false);
    expect(ctx.stopFeedbackAttempts).toBe(0);
    expect(ctx.messages.length).toBe(0);
  });

  it("test_first_non_first_feedback_decision_is_honored", async () => {
    // find() honors the first non-empty feedback among several decisions.
    const run = vi.fn<RunFn>(async () =>
      decisions({ decision: "allow" }, { decision: "feedback", feedback: "go" }),
    );
    const ctx = makeCtx();
    expect(await reflectAfterStop(makeInputs(run), ctx)).toBe(true);
    expect(ctx.stopFeedbackAttempts).toBe(1);
  });
});

// --- continueOrTerminate routing (the real production path) ---

function makeFullCtx(): LoopContext {
  return {
    messages: [],
    events: [],
    conversation: [],
    finalText: "",
    finalStatus: "running",
    nudgeAttempts: 0,
    stopFeedbackAttempts: 0,
  } as unknown as LoopContext;
}
function output(over: Record<string, unknown>): Parameters<typeof continueOrTerminate>[2] {
  return {
    text: "",
    toolCalls: [],
    stopReason: "end_turn",
    errored: false,
    ...over,
  } as unknown as Parameters<typeof continueOrTerminate>[2];
}

describe("continueOrTerminate stop routing (M1-4)", () => {
  it("test_stop_fires_on_clean_finish_and_finishes", async () => {
    // Clean finish (complete answer, no tools) → stop fires once, run finishes.
    const run = vi.fn<RunFn>(async () => decisions({ decision: "allow" }));
    const ctx = makeFullCtx();
    const result = await continueOrTerminate(
      makeInputs(run),
      ctx,
      output({ text: "final answer", stopReason: "end_turn" }),
    );
    expect(result).toBe("done");
    expect(ctx.finalStatus).toBe("finished");
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[0]).toMatchObject({ event: "stop" });
  });

  it("test_stop_not_fired_on_error_terminal", async () => {
    // EC-2: an errored turn returns "error" BEFORE the clean-finish branch — stop must NOT fire.
    const run = vi.fn<RunFn>(async () => decisions({ decision: "allow" }));
    const result = await continueOrTerminate(
      makeInputs(run),
      makeFullCtx(),
      output({ errored: true }),
    );
    expect(result).toBe("error");
    expect(run).not.toHaveBeenCalled();
  });

  it("test_nudge_takes_precedence_and_skips_stop", async () => {
    // An incomplete answer (empty text, no tools) triggers the nudge BEFORE reflect —
    // the stop hook must NOT fire on a nudged turn.
    const run = vi.fn<RunFn>(async () => decisions({ decision: "feedback", feedback: "x" }));
    const ctx = makeFullCtx();
    const result = await continueOrTerminate(
      makeInputs(run),
      ctx,
      output({ text: "", stopReason: "end_turn" }),
    );
    expect(result).toBe("continue");
    expect(run).not.toHaveBeenCalled(); // nudge won; stop not consulted this pass
  });

  it("test_reflection_ladder_feedback_then_clean_finish", async () => {
    // The real ladder: turn 1 finishes clean → stop returns feedback → continue;
    // turn 2 finishes clean → stop allows → done. stop fires on BOTH clean finishes.
    let call = 0;
    const run = vi.fn<RunFn>(async () => {
      call += 1;
      return call === 1
        ? decisions({ decision: "feedback", feedback: "keep going" })
        : decisions({ decision: "allow" });
    });
    const inputs = makeInputs(run);
    const ctx = makeFullCtx();
    const r1 = await continueOrTerminate(
      inputs,
      ctx,
      output({ text: "draft", stopReason: "end_turn" }),
    );
    expect(r1).toBe("continue");
    expect(JSON.stringify(ctx.messages)).toContain("keep going");
    const r2 = await continueOrTerminate(
      inputs,
      ctx,
      output({ text: "final", stopReason: "end_turn" }),
    );
    expect(r2).toBe("done");
    expect(ctx.finalStatus).toBe("finished");
    expect(run).toHaveBeenCalledTimes(2); // stop fired on each clean finish
  });
});
