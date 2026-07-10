import { afterEach, describe, expect, it } from "vitest";

import { createSkill } from "../src/create-skill.js";
import { Agent } from "../src/index.js";
import type { SDKAgent } from "../src/types/agent.js";

/**
 * SE20 — `agent.skills.get(name)` resolves a skill INCLUDING its body. `list()`
 * (name + description) already existed; `get` adds the `instructions`, read from
 * the inline `createSkill` body or a filesystem SKILL.md.
 */
describe("agent.skills.get (SE20)", () => {
  let agent: SDKAgent | undefined;
  afterEach(async () => {
    await agent?.dispose();
    agent = undefined;
  });

  it("returns an inline skill's full body via the agent handle", async () => {
    agent = await Agent.create({
      apiKey: "theo_test_se20",
      model: { id: "claude-sonnet-4-6" },
      skills: {
        inline: [
          createSkill({
            name: "summarize",
            description: "Summarize text",
            instructions: "Read the text and produce a 2-sentence summary.",
          }),
        ],
      },
    });

    // list() stays lean (name + description); get() carries the body.
    const list = await agent.skills?.list();
    expect(list?.map((s) => s.name)).toContain("summarize");

    const detail = await agent.skills?.get("summarize");
    expect(detail).toEqual({
      name: "summarize",
      description: "Summarize text",
      instructions: "Read the text and produce a 2-sentence summary.",
    });

    await expect(agent.skills?.get("no-such-skill")).resolves.toBeUndefined();
  });
});
