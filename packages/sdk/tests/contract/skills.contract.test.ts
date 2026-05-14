import { afterEach, describe, expect, it } from "vitest";

import { Agent, type AgentOptions, type SDKAgent } from "../../src/index.js";
import { createTempWorkspace, type TempWorkspace } from "../helpers/temp-workspace.js";

describe("skills contract", () => {
  let workspace: TempWorkspace | undefined;

  afterEach(async () => {
    await workspace?.cleanup();
    workspace = undefined;
  });

  it("loads file-based skills and makes them visible to runs without leaking full prompt bodies", async () => {
    workspace = await createTempWorkspace("project-with-skills");
    const options: ProposedAgentOptions = {
      apiKey: "theo_test_contract_key",
      model: { id: "composer-2" },
      local: { cwd: workspace.cwd, settingSources: ["project"] },
      skills: {
        enabled: ["code-review", "test-architect"],
      },
    };
    const agent = (await Agent.create(options)) as ProposedSDKAgent;

    const skills = await agent.skills.list();
    const run = await agent.send("Use the code-review skill to review this SDK contract.");
    const events = [];
    for await (const event of run.stream()) events.push(event);

    expect(skills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "code-review",
          description: expect.stringMatching(/Reviews TypeScript/),
        }),
        expect.objectContaining({
          name: "test-architect",
          description: expect.stringMatching(/red-first/),
        }),
      ]),
    );
    expect(JSON.stringify(events)).toContain("code-review");
    expect(JSON.stringify(events)).not.toContain(
      "Check public API compatibility, runtime behavior",
    );
  });

  it("reload picks up new skills and rejects malformed skill frontmatter", async () => {
    workspace = await createTempWorkspace("project-with-skills");
    const options: ProposedAgentOptions = {
      apiKey: "theo_test_contract_key",
      model: { id: "composer-2" },
      local: { cwd: workspace.cwd, settingSources: ["project"] },
      skills: { enabled: ["code-review"] },
    };
    const agent = (await Agent.create(options)) as ProposedSDKAgent;

    await workspace.writeText(
      ".theokit/skills/security/SKILL.md",
      "---\nname: security\ndescription: Security reviewer.\n---\n\nCheck secret handling.",
    );
    await agent.reload();
    await expect(agent.skills.list()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "security" })]),
    );

    await workspace.writeText(
      ".theokit/skills/bad/SKILL.md",
      "---\nname: bad\n---\n\nMissing description.",
    );
    await expect(agent.reload()).rejects.toMatchObject({
      name: "ConfigurationError",
      message: expect.stringMatching(/skill|description/i),
    });
  });
});

type ProposedAgentOptions = AgentOptions & {
  skills?: {
    enabled?: string[];
    paths?: string[];
  };
};

type ProposedSDKAgent = SDKAgent & {
  skills: {
    list(): Promise<Array<{ name: string; description: string }>>;
  };
};
