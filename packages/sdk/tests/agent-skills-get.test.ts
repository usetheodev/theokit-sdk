import { afterEach, describe, expect, it } from "vitest";

import { Skill } from "../src/create-skill.js";
import { Agent } from "../src/index.js";
import type { SDKAgent } from "../src/types/agent.js";
import { useTempCwd } from "./helpers/temp-workspace.js";

// Agent.create defaults its workspace to process.cwd(), which during a test run is the
// package itself — this file created agents without saying where, and the state landed in
// packages/sdk/.theokit/. See useTempCwd's docblock for the 540 MB that bought.
useTempCwd();

/**
 * SE20 — `agent.skills.get(name)` resolves a skill INCLUDING its body. `list()`
 * (name + description) already existed; `get` adds the `instructions`, read from
 * the inline `Skill` body or a filesystem SKILL.md.
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
          Skill.create({
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

  it("surfaces an inline skill's references via get (SE21)", async () => {
    agent = await Agent.create({
      apiKey: "theo_test_se21",
      model: { id: "claude-sonnet-4-6" },
      skills: {
        inline: [
          Skill.create({
            name: "release",
            description: "Release checklist",
            instructions: "Run the checklist.",
            references: { "changelog-format.md": "# Keep a Changelog" },
          }),
        ],
      },
    });

    const detail = await agent.skills?.get("release");
    expect(detail?.references).toEqual({ "changelog-format.md": "# Keep a Changelog" });
  });

  it("list() never leaks an inline skill's body or references (SE21 boundary)", async () => {
    agent = await Agent.create({
      apiKey: "theo_test_se21_leak",
      model: { id: "claude-sonnet-4-6" },
      skills: {
        inline: [
          Skill.create({
            name: "release",
            description: "Release checklist",
            instructions: "SECRET BODY — must not appear in list().",
            references: { "secret.md": "SECRET REFERENCE — must not appear in list()." },
          }),
        ],
      },
    });

    const list = await agent.skills?.list();
    const entry = list?.find((s) => s.name === "release");
    // The public contract (SystemPromptSkillRef) is name + description + source — the BODY and
    // REFERENCES are reachable exclusively through get(). `source` was excluded here entirely
    // until usetheokit/theokit-sdk#524 asked for it: a consumer could not tell a skill came from
    // code rather than disk. `createSkill` already marks that with the synthetic `inline://<name>`
    // value (see create-skill.ts) — it is not new data, it was simply not reaching this contract.
    expect(entry).toEqual({
      name: "release",
      description: "Release checklist",
      source: "inline://release",
    });
    expect(entry).not.toHaveProperty("instructions");
    expect(entry).not.toHaveProperty("references");
  });
});
