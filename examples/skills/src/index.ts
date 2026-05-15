import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Agent } from "@usetheo/sdk";

/**
 * File-based skills loader. Each skill is a directory at
 * `.theokit/skills/<name>/SKILL.md` with YAML frontmatter (name +
 * description) and a body that is the skill's instructions.
 *
 * `agent.skills.list()` returns ONLY public metadata (name + description) —
 * the full body is never leaked through the public surface.
 */

function pickModel(): string {
  if (process.env.ANTHROPIC_API_KEY) return "claude-sonnet-4-5-20250929";
  if (process.env.OPENAI_API_KEY) return "gpt-4o-mini";
  if (process.env.OPENROUTER_API_KEY) return "openai/gpt-4o-mini";
  throw new Error("Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or OPENROUTER_API_KEY in .env.");
}

async function setupWorkspace(): Promise<string> {
  const cwd = join(process.cwd(), "workspace");
  const skillsRoot = join(cwd, ".theokit", "skills");
  await mkdir(join(skillsRoot, "code-review"), { recursive: true });
  await mkdir(join(skillsRoot, "doc-writer"), { recursive: true });
  await writeFile(
    join(skillsRoot, "code-review", "SKILL.md"),
    "---\nname: code-review\ndescription: Review TypeScript diffs for type safety, error handling, and tests.\n---\n\nFull prompt body — never exposed publicly.\n",
  );
  await writeFile(
    join(skillsRoot, "doc-writer", "SKILL.md"),
    "---\nname: doc-writer\ndescription: Produce concise developer-facing documentation in markdown.\n---\n\nFull prompt body — never exposed publicly.\n",
  );
  return cwd;
}

async function main(): Promise<void> {
  const cwd = await setupWorkspace();
  const agent = await Agent.create({
    apiKey: process.env.THEOKIT_API_KEY ?? "user-real-example-key",
    model: { id: pickModel() },
    local: { cwd, settingSources: ["project"] },
  });

  if (agent.skills !== undefined) {
    const skills = await agent.skills.list();
    console.log(`Loaded ${skills.length} skill(s):`);
    for (const skill of skills) {
      console.log(`  - ${skill.name}: ${skill.description}`);
    }
  } else {
    console.log("Skills manager not active (need settingSources: ['project'])");
  }

  const run = await agent.send(
    "Two skills are loaded. List them by name only, separated by commas, and don't include the descriptions.",
  );
  const result = await run.wait();
  console.log(`\n${result.result}`);
}

main().catch((cause) => {
  console.error("skills failed:", cause);
  process.exit(1);
});
