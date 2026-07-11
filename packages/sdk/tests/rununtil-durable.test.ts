import { describe, expect, it } from "vitest";

import { InMemoryConversationStorage } from "../src/internal/persistence/conversation-storage-memory.js";
import {
  persistDurableProgress,
  resolveDurableRun,
} from "../src/internal/runtime/local-agent/local-agent-goal-extensions.js";
import { localAgentRunUntil } from "../src/internal/runtime/local-agent/local-agent-runtime-extensions.js";
import { setObjective } from "../src/internal/runtime/objective/objective-store.js";
import type { SDKAgent } from "../src/types/agent.js";
import type { GoalEvent, GoalResult } from "../src/types/goal-events.js";

/**
 * SE33 (ADR 0012 D4) — `runUntil()` resolving a durable thread-scoped objective:
 * precedence, budget capping, progress write-back, and the paused-degradation
 * paths. Deterministic — the loop body (LLM send + judge) is never reached in
 * the no-goal degradation cases, and the helpers are pure over the adapter.
 */

async function drain(
  gen: AsyncGenerator<GoalEvent, GoalResult, void>,
): Promise<{ events: GoalEvent[]; result: GoalResult }> {
  const events: GoalEvent[] = [];
  let next = await gen.next();
  while (!next.done) {
    events.push(next.value);
    next = await gen.next();
  }
  return { events, result: next.value };
}

describe("SE33 — runUntil durable objective resolution", () => {
  it("resolveDurableRun → { kind: 'none' } when no objective is set", async () => {
    const s = new InMemoryConversationStorage();
    expect(await resolveDurableRun(s, undefined, "t1", undefined)).toEqual({ kind: "none" });
  });

  it("resolveDurableRun → { kind: 'inert' } when an objective is set but no judge resolves (activation switch)", async () => {
    const s = new InMemoryConversationStorage();
    await setObjective(s, "t1", "Ship", { maxRuns: 10 }); // no judgeModel anywhere
    expect(await resolveDurableRun(s, undefined, "t1", undefined)).toEqual({ kind: "inert" });
    // A standing-config judge activates it.
    const activated = await resolveDurableRun(s, { judgeModel: "cfg/model" }, "t1", undefined);
    expect(activated.kind).toBe("run");
  });

  it("resolveDurableRun → { kind: 'exhausted' } when the durable budget is fully spent (MEDIUM-3)", async () => {
    const s = new InMemoryConversationStorage();
    await setObjective(s, "t1", "Ship", { maxRuns: 3, judgeModel: "obj/model" });
    await persistDurableProgress(s, "t1", { status: "failed", turnsUsed: 3, finalResponse: "x" });
    // runsUsed (3) === maxRuns (3) → no remaining budget → do NOT enter the loop.
    expect(await resolveDurableRun(s, undefined, "t1", undefined)).toEqual({ kind: "exhausted" });
  });

  it("resolveDurableRun caps per-call maxTurns by the durable budget remaining", async () => {
    const s = new InMemoryConversationStorage();
    await setObjective(s, "t1", "Ship the feature", { maxRuns: 5, judgeModel: "obj/model" });
    // 3 runs already used → remaining budget is 2.
    await persistDurableProgress(s, "t1", { status: "failed", turnsUsed: 3, finalResponse: "x" });

    // Caller asks for 10 turns; the durable remaining budget (2) wins.
    const resolved = await resolveDurableRun(s, undefined, "t1", { maxTurns: 10 });
    expect(resolved).toMatchObject({ kind: "run", goal: "Ship the feature" });
    if (resolved.kind === "run") expect(resolved.options.maxTurns).toBe(2);
  });

  it("resolveDurableRun precedence: per-call > per-objective > standing goal config", async () => {
    const s = new InMemoryConversationStorage();
    await setObjective(s, "t1", "Ship", { maxRuns: 40, judgeModel: "obj/model" });
    // Per-call judgeModel wins over the per-objective one.
    const perCall = await resolveDurableRun(s, { judgeModel: "cfg/model" }, "t1", {
      judgeModel: "call/model",
    });
    expect(perCall.kind === "run" && perCall.options.judgeModel).toBe("call/model");
    // Without a per-call override, the per-objective one wins over the standing config.
    const perObjective = await resolveDurableRun(s, { judgeModel: "cfg/model" }, "t1", undefined);
    expect(perObjective.kind === "run" && perObjective.options.judgeModel).toBe("obj/model");
  });

  it("persistDurableProgress maps completed→done, paused→paused, failed→active and accumulates runsUsed", async () => {
    const s = new InMemoryConversationStorage();
    await setObjective(s, "t1", "Ship", { maxRuns: 50 });

    await persistDurableProgress(s, "t1", { status: "failed", turnsUsed: 4, finalResponse: "a" });
    let rec = await s.getObjectiveRecord?.("t1");
    expect(rec?.status).toBe("active"); // budget-exhausted failure keeps working next resume
    expect(rec?.runsUsed).toBe(4);

    await persistDurableProgress(s, "t1", { status: "paused", turnsUsed: 1, finalResponse: "b" });
    rec = await s.getObjectiveRecord?.("t1");
    expect(rec?.status).toBe("paused");
    expect(rec?.runsUsed).toBe(5);

    await persistDurableProgress(s, "t1", {
      status: "completed",
      turnsUsed: 2,
      finalResponse: "c",
    });
    rec = await s.getObjectiveRecord?.("t1");
    expect(rec?.status).toBe("done");
    expect(rec?.runsUsed).toBe(7);
  });

  it("runUntil(no goal, no threadId) degrades to a single paused event (never touches the loop)", async () => {
    const agent = {} as SDKAgent; // never used on this path
    const { events, result } = await drain(localAgentRunUntil(agent, undefined, undefined));
    expect(result.status).toBe("paused");
    expect(result.turnsUsed).toBe(0);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "status_change", status: "paused" });
  });

  it("runUntil(no goal) with a threadId but no objective set degrades to paused", async () => {
    const s = new InMemoryConversationStorage();
    const agent = {} as SDKAgent;
    const gen = localAgentRunUntil(
      agent,
      undefined,
      { threadId: "t1" },
      {
        handle: s,
        goalConfig: undefined,
      },
    );
    const { events, result } = await drain(gen);
    expect(result.status).toBe("paused");
    expect(result.turnsUsed).toBe(0);
    expect(events[0]).toMatchObject({ type: "status_change", status: "paused" });
    expect((events[0] as { reason: string }).reason).toContain("no durable objective");
  });

  it("runUntil(no goal) on an exhausted objective degrades to paused without entering the loop (MEDIUM-3)", async () => {
    const s = new InMemoryConversationStorage();
    await setObjective(s, "t1", "Ship", { maxRuns: 2, judgeModel: "obj/model" });
    await persistDurableProgress(s, "t1", { status: "failed", turnsUsed: 2, finalResponse: "x" });
    const agent = {} as SDKAgent; // loop never entered → agent unused
    const gen = localAgentRunUntil(
      agent,
      undefined,
      { threadId: "t1" },
      { handle: s, goalConfig: undefined },
    );
    const { events, result } = await drain(gen);
    expect(result.status).toBe("paused");
    expect(result.turnsUsed).toBe(0);
    expect((events[0] as { reason: string }).reason).toContain("exhausted its run budget");
  });
});
