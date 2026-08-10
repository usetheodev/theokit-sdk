import { describe, expect, it } from "vitest";

import { runGoalLoop } from "../src/goal-loop.js";
import type { JudgeResult } from "../src/internal/judge/types.js";

/** M56 — public loop over a minimal send→wait surface (custom transports render their own turns). */
describe("runGoalLoop (public)", () => {
  it("drives_a_minimal_send_wait_agent_to_completion", async () => {
    const sent: string[] = [];
    const agent = {
      async send(prompt: string) {
        sent.push(prompt);
        return {
          wait: async () => ({
            result: `answer-${sent.length}`,
            usage: { inputTokens: 10, outputTokens: 0, totalTokens: 10 },
          }),
        };
      },
    };
    let calls = 0;
    const judge = async (): Promise<JudgeResult> => {
      calls += 1;
      return calls < 2
        ? { verdict: "continue", reason: "more", parseFailed: false }
        : { verdict: "done", reason: "ok", parseFailed: false };
    };
    const gen = runGoalLoop(agent, "goal X", { maxTurns: 5 }, { judge });
    const events: unknown[] = [];
    let result: unknown;
    while (true) {
      const r = await gen.next();
      if (r.done === true) {
        result = r.value;
        break;
      }
      events.push(r.value);
    }
    expect(sent.length).toBe(2); // turn 1 (goal) + turn 2 (continuation)
    expect(sent[1]).toContain("goal X"); // the continuation carries the goal intact
    expect((result as { status: string }).status).toBe("completed");
    expect((result as { tokensUsed: number }).tokensUsed).toBe(20);
  });
});
