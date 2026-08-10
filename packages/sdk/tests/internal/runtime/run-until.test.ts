/**
 * Tests for the goal-driven Ralph loop (T3.2, ADRs D115-D121).
 *
 * Uses fake agent + injected judge so we exercise the state machine
 * without real LLM calls.
 */

import { describe, expect, it } from "vitest";
import type { JudgeResult } from "../../../src/internal/judge/types.js";
import { runUntilImpl } from "../../../src/internal/runtime/lifecycle/run-until.js";
import type { SDKAgent } from "../../../src/types/agent.js";
import type { GoalEvent, GoalResult } from "../../../src/types/goal-events.js";

function buildFakeAgent(responses: string[]): SDKAgent {
  let i = 0;
  const agent = {
    agentId: "fake",
    async send() {
      const text = responses[i] ?? "no more responses";
      i += 1;
      return {
        wait: async () => ({ result: text }),
      };
    },
    close() {},
    async reload() {},
    async dispose() {},
    async [Symbol.asyncDispose]() {},
    async listArtifacts() {
      return [];
    },
    async downloadArtifact(): Promise<Buffer> {
      throw new Error("no");
    },
  } as unknown as SDKAgent;
  return agent;
}

async function collect(
  gen: AsyncGenerator<GoalEvent, GoalResult, void>,
): Promise<{ events: GoalEvent[]; result: GoalResult }> {
  const events: GoalEvent[] = [];
  let result: GoalResult | undefined;
  while (true) {
    const r = await gen.next();
    if (r.done === true) {
      result = r.value;
      break;
    }
    events.push(r.value);
  }
  return { events, result: result! };
}

describe("runUntilImpl (T3.2)", () => {
  it("yields active → completed when judge says DONE on turn 1", async () => {
    const agent = buildFakeAgent(["I did it"]);
    const judge = async (): Promise<JudgeResult> => ({
      verdict: "done",
      reason: "great job",
      parseFailed: false,
    });
    const { events, result } = await collect(runUntilImpl(agent, "g", undefined, { judge }));
    const statuses = events.filter((e) => e.type === "status_change");
    expect(statuses).toHaveLength(2);
    expect(statuses[0]).toMatchObject({ status: "active" });
    expect(statuses[1]).toMatchObject({ status: "completed" });
    expect(result.status).toBe("completed");
    expect(result.turnsUsed).toBe(1);
    expect(result.finalResponse).toBe("I did it");
  });

  it("loops via continue until done", async () => {
    const agent = buildFakeAgent(["attempt 1", "attempt 2", "attempt 3"]);
    let calls = 0;
    const judge = async (): Promise<JudgeResult> => {
      calls += 1;
      if (calls < 3) {
        return { verdict: "continue", reason: "not yet", parseFailed: false };
      }
      return { verdict: "done", reason: "finally", parseFailed: false };
    };
    const { events, result } = await collect(runUntilImpl(agent, "g", undefined, { judge }));
    const turnStarts = events.filter((e) => e.type === "turn_start");
    expect(turnStarts).toHaveLength(3);
    expect(result.status).toBe("completed");
    expect(result.turnsUsed).toBe(3);
  });

  it("bails after max consecutive judge failures (default 3)", async () => {
    const agent = buildFakeAgent(["x", "x", "x", "x", "x"]);
    const judge = async (): Promise<JudgeResult> => ({
      verdict: "continue",
      reason: "malformed",
      parseFailed: true,
    });
    const { events, result } = await collect(
      runUntilImpl(agent, "g", { maxConsecutiveJudgeFailures: 3, maxTurns: 10 }, { judge }),
    );
    expect(result.status).toBe("failed");
    expect(result.turnsUsed).toBe(3);
    const failure = events.find((e) => e.type === "status_change" && e.status === "failed");
    expect(failure?.type).toBe("status_change");
    expect((failure as { reason?: string }).reason).toMatch(/parse failures/);
  });

  it("max turns exhausted returns failed", async () => {
    const agent = buildFakeAgent(["a", "b"]);
    const judge = async (): Promise<JudgeResult> => ({
      verdict: "continue",
      reason: "more",
      parseFailed: false,
    });
    const { result } = await collect(runUntilImpl(agent, "g", { maxTurns: 2 }, { judge }));
    expect(result.status).toBe("failed");
    expect(result.turnsUsed).toBe(2);
  });

  it("skipped verdict completes early", async () => {
    const agent = buildFakeAgent(["already done"]);
    const judge = async (): Promise<JudgeResult> => ({
      verdict: "skipped",
      reason: "already true",
      parseFailed: false,
    });
    const { events, result } = await collect(runUntilImpl(agent, "g", undefined, { judge }));
    expect(result.status).toBe("completed");
    const final = events.at(-1);
    expect(final?.type).toBe("status_change");
    expect((final as { reason?: string }).reason).toContain("skipped");
  });

  it("AbortSignal mid-loop yields paused on next turn boundary", async () => {
    const agent = buildFakeAgent(["a", "b", "c"]);
    const controller = new AbortController();
    let callCount = 0;
    const judge = async (): Promise<JudgeResult> => {
      callCount += 1;
      if (callCount === 1) {
        controller.abort();
      }
      return { verdict: "continue", reason: "more", parseFailed: false };
    };
    const { events, result } = await collect(
      runUntilImpl(agent, "g", { signal: controller.signal, maxTurns: 5 }, { judge }),
    );
    expect(result.status).toBe("paused");
    const paused = events.find((e) => e.type === "status_change" && e.status === "paused");
    expect(paused).toBeDefined();
  });

  // EC-C: pre-aborted signal yields paused only, no active.
  it("EC-C: pre-aborted signal yields paused only (no active)", async () => {
    const agent = buildFakeAgent(["x"]);
    const controller = new AbortController();
    controller.abort();
    const judge = async (): Promise<JudgeResult> => ({
      verdict: "done",
      reason: "n/a",
      parseFailed: false,
    });
    const { events, result } = await collect(
      runUntilImpl(agent, "g", { signal: controller.signal }, { judge }),
    );
    const statuses = events.filter((e) => e.type === "status_change");
    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toMatchObject({ status: "paused" });
    expect(result.turnsUsed).toBe(0);
    expect(result.finalResponse).toBeUndefined();
  });

  // EC-D: maxTurns: 0 yields active + failed.
  it("EC-D: maxTurns=0 yields active then failed (max turns exhausted)", async () => {
    const agent = buildFakeAgent([]);
    const judge = async (): Promise<JudgeResult> => ({
      verdict: "done",
      reason: "",
      parseFailed: false,
    });
    const { events, result } = await collect(runUntilImpl(agent, "g", { maxTurns: 0 }, { judge }));
    expect(result.status).toBe("failed");
    expect(result.turnsUsed).toBe(0);
    const statuses = events.filter((e) => e.type === "status_change");
    expect(statuses).toHaveLength(2);
    expect((statuses[1] as { reason?: string }).reason).toMatch(/max turns/);
  });

  it("emits turn_start + agent_response + judge_verdict per turn", async () => {
    const agent = buildFakeAgent(["r"]);
    const judge = async (): Promise<JudgeResult> => ({
      verdict: "done",
      reason: "",
      parseFailed: false,
    });
    const { events } = await collect(runUntilImpl(agent, "g", undefined, { judge }));
    const turnTypes = events.filter((e) => e.type === "turn_start").length;
    const respTypes = events.filter((e) => e.type === "agent_response").length;
    const verdictTypes = events.filter((e) => e.type === "judge_verdict").length;
    expect(turnTypes).toBe(1);
    expect(respTypes).toBe(1);
    expect(verdictTypes).toBe(1);
  });
});

// --- M55 (agent-builder autonomous goal) — token budget + budget_limited state + faithful continuation ---

function buildFakeAgentWithUsage(responses: string[], perTurnTokens: number | undefined): SDKAgent {
  let i = 0;
  return {
    agentId: "fake-usage",
    async send() {
      const text = responses[i] ?? responses[responses.length - 1] ?? "…";
      i += 1;
      return {
        wait: async () => ({
          result: text,
          ...(perTurnTokens !== undefined
            ? { usage: { inputTokens: perTurnTokens, outputTokens: 0, totalTokens: perTurnTokens } }
            : {}),
        }),
      };
    },
    close() {},
    async reload() {},
    async dispose() {},
    async [Symbol.asyncDispose]() {},
    async listArtifacts() {
      return [];
    },
    async downloadArtifact(): Promise<Buffer> {
      throw new Error("no");
    },
  } as unknown as SDKAgent;
}

const alwaysContinue = async (): Promise<JudgeResult> => ({
  verdict: "continue",
  reason: "keep going",
  parseFailed: false,
});

describe("M55 — token budget + budget_limited state", () => {
  it("budget_limited_fires_when_tokens_cross", async () => {
    // 60 tokens/turn, budget 100 -> after turn 2 (120 > 100) it stops with budget_limited
    const agent = buildFakeAgentWithUsage(["r1", "r2", "r3"], 60);
    const { events, result } = await collect(
      runUntilImpl(agent, "goal X", { tokenBudget: 100, maxTurns: 20 }, { judge: alwaysContinue }),
    );
    expect(result.status).toBe("budget_limited");
    expect(result.turnsUsed).toBe(2);
    expect(result.tokensUsed).toBeGreaterThanOrEqual(100);
    expect(events.some((e) => e.type === "status_change" && e.status === "budget_limited")).toBe(
      true,
    );
  });

  it("token_budget_absent_usage_never_trips", async () => {
    // usage absent → the budget never counts (fail-open); stops at maxTurns=2 → failed
    const agent = buildFakeAgentWithUsage(["r1", "r2"], undefined);
    const { result } = await collect(
      runUntilImpl(agent, "goal", { tokenBudget: 10, maxTurns: 2 }, { judge: alwaysContinue }),
    );
    expect(result.status).toBe("failed"); // maxTurns, not budget_limited
    expect(result.tokensUsed).toBe(0);
  });

  it("maxTurns_still_caps_as_safety_without_budget", async () => {
    const agent = buildFakeAgentWithUsage(["r1", "r2", "r3"], 5);
    const { result } = await collect(
      runUntilImpl(agent, "goal", { maxTurns: 2 }, { judge: alwaysContinue }),
    );
    expect(result.status).toBe("failed");
    expect(result.turnsUsed).toBe(2);
  });

  it("result_reports_tokensUsed_on_completion", async () => {
    const agent = buildFakeAgentWithUsage(["done-ish"], 42);
    const doneJudge = async (): Promise<JudgeResult> => ({
      verdict: "done",
      reason: "ok",
      parseFailed: false,
    });
    const { result } = await collect(runUntilImpl(agent, "goal", {}, { judge: doneJudge }));
    expect(result.status).toBe("completed");
    expect(result.tokensUsed).toBe(42);
  });
});

describe("M55 — continuation faithful to Codex", () => {
  it("continuation_prompt_keeps_full_objective_and_audit_language", async () => {
    const agent = buildFakeAgentWithUsage(["r1", "r2", "r3"], 1);
    const { events } = await collect(
      runUntilImpl(agent, "WHOLE_GOAL_XYZ", { maxTurns: 3 }, { judge: alwaysContinue }),
    );
    // turn 1 sends the raw goal; the FAITHFUL continuation appears on turns 2+ (a composed prompt).
    const cont = events.find((e) => e.type === "continuation" && e.turn >= 2);
    expect(cont).toBeDefined();
    if (cont && cont.type === "continuation") {
      expect(cont.prompt).toContain("WHOLE_GOAL_XYZ"); // goal intact
      expect(cont.prompt.toLowerCase()).toMatch(/evidence|audit/); // language faithful to continuation.md
    }
  });
});

describe("M55 review — abort threaded into the in-flight run", () => {
  it("abort_during_send_cancels_run_and_skips_judge", async () => {
    const controller = new AbortController();
    let cancelCalled = false;
    let judgeCalled = 0;
    // wait() pends until cancel() is called (mimics a long interruptible turn)
    const agent = {
      agentId: "fake-abort",
      async send() {
        // aborts WHILE the turn is in flight
        setTimeout(() => controller.abort(), 10);
        let unblock: () => void;
        const blocked = new Promise<void>((r) => {
          unblock = r;
        });
        return {
          cancel: async () => {
            cancelCalled = true;
            unblock();
          },
          wait: async () => {
            await blocked;
            return { result: "interrupted" };
          },
        };
      },
      close() {},
      async reload() {},
      async dispose() {},
      async [Symbol.asyncDispose]() {},
      async listArtifacts() {
        return [];
      },
      async downloadArtifact(): Promise<Buffer> {
        throw new Error("no");
      },
    } as unknown as SDKAgent;
    const judge = async (): Promise<JudgeResult> => {
      judgeCalled += 1;
      return { verdict: "continue", reason: "n/a", parseFailed: false };
    };
    const { result } = await collect(
      runUntilImpl(agent, "goal", { signal: controller.signal }, { judge }),
    );
    expect(cancelCalled).toBe(true); // the abort CANCELLED the in-flight run (it did not wait for the turn)
    expect(judgeCalled).toBe(0); // post-abort spends no judge
    expect(result.status).toBe("paused");
    expect(result.turnsUsed).toBe(1);
  });
});

describe("M56 review — marked continuation + tail-biased preview", () => {
  it("continuation_carries_stable_marker_and_tail_of_last_response", async () => {
    const { composeContinuation } = await import(
      "../../../src/internal/runtime/lifecycle/run-until.js"
    );
    const { GOAL_CONTINUATION_MARKER } = await import("../../../src/goal-loop.js");
    const long = `START ${"x".repeat(2000)} FINAL-CONCLUSION`;
    const prompt = composeContinuation("obj", long);
    // stable marker on the 1st line — consumers (collapsed timeline, backtrack, compact) detect
    expect(prompt.startsWith(GOAL_CONTINUATION_MARKER)).toBe(true);
    // tail-biased preview: the previous turn's CONCLUSION survives, not the opening narration
    expect(prompt).toContain("FINAL-CONCLUSION");
    expect(prompt).not.toContain("START ");
  });
});
