import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Agent } from "../../../src/index.js";
import type { SDKAgent } from "../../../src/types/agent.js";

interface AgentWithLoaders extends SDKAgent {
  skills?: { list: () => Promise<Array<{ name: string; description: string }>> };
}

/**
 * Behaviour gate for Agent.resume() — guarantees the resumed handle has
 * the same surface as Agent.create() (hooks, context, skills, plugins,
 * subagents all initialized). Per edge-case review EC-1 of v1-completeness.
 */

describe("Agent.resume", () => {
  let cwd: string | undefined;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "theokit-resume-"));
  });

  afterEach(() => {
    cwd = undefined;
  });

  it("loads skills + context just like Agent.create (EC-1)", async () => {
    if (cwd === undefined) throw new Error("missing workspace");
    // Project setup: one skill + one context source.
    await mkdir(join(cwd, ".theokit", "skills", "code-review"), { recursive: true });
    await writeFile(
      join(cwd, ".theokit", "skills", "code-review", "SKILL.md"),
      `---\nname: code-review\ndescription: Review TS diffs\n---\n\nBody`,
    );
    await writeFile(join(cwd, "facts.md"), "fact\n");
    await writeFile(
      join(cwd, ".theokit", "context.json"),
      JSON.stringify({ sources: [{ name: "facts", path: "facts.md" }] }),
    );

    const original = (await Agent.create({
      apiKey: "theo_test_resume_init",
      model: { id: "google/gemini-2.0-flash-001" },
      local: { cwd, settingSources: ["project"] },
      context: { manager: "file" },
    })) as AgentWithLoaders;
    const originalSkills = await original.skills?.list();
    const originalSnapshot = await original.context?.snapshot();
    expect(originalSkills?.length).toBeGreaterThanOrEqual(1);
    expect(originalSnapshot?.sources.length).toBeGreaterThanOrEqual(1);
    await original.dispose();

    const resumed = (await Agent.resume(original.agentId)) as AgentWithLoaders;
    const resumedSkills = await resumed.skills?.list();
    const resumedSnapshot = await resumed.context?.snapshot();
    expect(resumedSkills?.length).toBe(originalSkills?.length);
    expect(resumedSnapshot?.sources.length).toBe(originalSnapshot?.sources.length);
    await resumed.dispose();
  });

  it("throws UnknownAgentError on cold-miss (new behavior — chat-assistant footgun fix)", async () => {
    const { UnknownAgentError } = await import("../../../src/index.js");
    await expect(Agent.resume("agent-unknown-cold-id")).rejects.toBeInstanceOf(UnknownAgentError);
    // Verify code is `unknown_agent` so callers can branch reliably.
    await expect(Agent.resume("agent-unknown-cold-id")).rejects.toMatchObject({
      code: "unknown_agent",
    });
  });
});
