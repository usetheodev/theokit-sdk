import { describe, expect, it } from "vitest";

import { Skill } from "../src/create-skill.js";
import { SkillsManager } from "../src/internal/runtime/skills/skills-manager.js";
import {
  assembleSystemPromptForSend,
  buildSystemPromptContext,
  type LocalAssemblyInputs,
} from "../src/internal/runtime/system-prompt/local-assembly.js";
import { SystemPromptPipeline } from "../src/internal/runtime/system-prompt/pipeline.js";
import type { AgentOptions } from "../src/types/agent.js";

/**
 * SE22 — dynamic skills resolver. `AgentOptions.skills` accepts a resolver
 * `(ctx) => SkillsSettings` evaluated per send BEFORE skill assembly (mirrors
 * the systemPrompt resolver). A static object behaves exactly as today.
 */

function makeInputs(
  skills: AgentOptions["skills"],
  skillsManager?: SkillsManager,
): LocalAssemblyInputs {
  return {
    agentId: "a1",
    workspaceCwd: "/nonexistent",
    model: undefined,
    options: { skills },
    context: undefined,
    skillsManager,
    settingSourcesIncludeProject: false,
    systemPromptPipeline: SystemPromptPipeline.default(),
  };
}

describe("SE22 — dynamic skills resolver", () => {
  it("honors a per-run resolver: different context → different <skills> block", async () => {
    const resolver: AgentOptions["skills"] = (ctx) => ({
      inline: [
        Skill.create({
          name: ctx.userMessage === "admin" ? "admin-tools" : "user-tools",
          description: `Skills for ${ctx.userMessage}`,
          instructions: "body",
        }),
      ],
    });
    const inputs = makeInputs(resolver);

    const adminPrompt = await assembleSystemPromptForSend({
      inputs: inputs,
      userText: "admin",
      baseSystemPrompt: undefined,
      memoryFacts: [],
      activeMemorySummary: undefined,
    });
    expect(adminPrompt).toContain("admin-tools");
    expect(adminPrompt).not.toContain("user-tools");

    const userPrompt = await assembleSystemPromptForSend({
      inputs: inputs,
      userText: "user",
      baseSystemPrompt: undefined,
      memoryFacts: [],
      activeMemorySummary: undefined,
    });
    expect(userPrompt).toContain("user-tools");
    expect(userPrompt).not.toContain("admin-tools");
  });

  it("a static SkillsSettings object is unchanged (back-compat, uses the base manager)", async () => {
    const mgr = new SkillsManager("/nonexistent", undefined, false, undefined, [
      Skill.create({ name: "static-skill", description: "A static skill", instructions: "b" }),
    ]);
    await mgr.initialize();
    const inputs = makeInputs({ enabled: ["static-skill"] }, mgr);

    const prompt = await assembleSystemPromptForSend({
      inputs: inputs,
      userText: "hi",
      baseSystemPrompt: undefined,
      memoryFacts: [],
      activeMemorySummary: undefined,
    });
    expect(prompt).toContain("static-skill");
    expect(prompt).toContain("A static skill");
  });

  it("honors the resolver's autoInject: false (no <skills> block)", async () => {
    const resolver: AgentOptions["skills"] = () => ({
      autoInject: false,
      inline: [Skill.create({ name: "hidden-skill", description: "d", instructions: "b" })],
    });
    const prompt = await assembleSystemPromptForSend({
      inputs: makeInputs(resolver),
      userText: "x",
      baseSystemPrompt: undefined,
      memoryFacts: [],
      activeMemorySummary: undefined,
    });
    expect(prompt ?? "").not.toContain("hidden-skill");
  });

  it("resolver fires exactly once per assembly; the base ctx path never invokes it", async () => {
    let calls = 0;
    const resolver: AgentOptions["skills"] = () => {
      calls++;
      return { inline: [Skill.create({ name: "counted", description: "d", instructions: "b" })] };
    };
    const inputs = makeInputs(resolver);

    await assembleSystemPromptForSend({
      inputs: inputs,
      userText: "x",
      baseSystemPrompt: undefined,
      memoryFacts: [],
      activeMemorySummary: undefined,
    });
    expect(calls).toBe(1); // resolved exactly once in the assembly path

    // The systemPrompt-resolver ctx path uses the base manager, never the resolver.
    const baseCtx = await buildSystemPromptContext(inputs, "x", []);
    expect(calls).toBe(1); // unchanged — the base ctx path did not re-invoke the resolver
    expect(baseCtx.skills).toEqual([]); // base manager is undefined here → empty list
  });

  it("a throwing resolver fails the run — no silent fallback (Rule 8)", async () => {
    const resolver: AgentOptions["skills"] = () => {
      throw new Error("resolver boom");
    };
    await expect(
      assembleSystemPromptForSend({
        inputs: makeInputs(resolver),
        userText: "x",
        baseSystemPrompt: undefined,
        memoryFacts: [],
        activeMemorySummary: undefined,
      }),
    ).rejects.toThrow("resolver boom");
  });
});
