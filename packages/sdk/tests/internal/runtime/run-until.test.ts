/**
 * Tests for the goal-driven Ralph loop (T3.2, ADRs D115-D121).
 *
 * Uses fake agent + injected judge so we exercise the state machine
 * without real LLM calls.
 */

import { describe, expect, it } from "vitest";
import type { JudgeResult } from "../../../src/internal/judge/types.js";
import { runUntilImpl } from "../../../src/internal/runtime/run-until.js";
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
