import { describe, expect, it } from "vitest";

import { ReasoningTools } from "../src/reasoning-tools.js";

describe("SE37 — ReasoningTools.create()", () => {
  it("returns think + analyze by default", () => {
    expect(
      ReasoningTools.create()
        .map((t) => t.name)
        .sort(),
    ).toEqual(["analyze", "think"]);
  });

  it("returns think only when analyze is disabled", () => {
    expect(ReasoningTools.create({ analyze: false }).map((t) => t.name)).toEqual(["think"]);
  });

  it("the think handler echoes the thought (no-side-effect scratchpad)", async () => {
    const [think] = ReasoningTools.create({ analyze: false });
    if (think === undefined) throw new Error("expected a think tool");
    expect(await think.handler({ thought: "0.90 > 0.11" })).toBe("0.90 > 0.11");
  });

  it("the think tool rejects an empty thought (fail-loud at handler)", async () => {
    const [think] = ReasoningTools.create({ analyze: false });
    if (think === undefined) throw new Error("expected a think tool");
    await expect(think.handler({ thought: "" })).rejects.toThrow(/thought/i);
  });

  it("analyze echoes a structured summary carrying the next action", async () => {
    const analyze = ReasoningTools.create()[1];
    if (analyze === undefined) throw new Error("expected an analyze tool");
    const out = await analyze.handler({
      result: "9.9 > 9.11",
      analysis: "0.90 > 0.11 in the tenths place",
      next_action: "final_answer",
    });
    expect(String(out)).toContain("Next: final_answer");
  });
});
