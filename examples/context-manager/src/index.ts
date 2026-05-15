import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Agent } from "@usetheo/sdk";

/**
 * File-based context manager. The SDK reads `.theokit/context.json`
 * from the workspace, loads each declared source, tokenises the
 * content, and exposes a redacted snapshot via `agent.context.snapshot()`.
 *
 * The agent is then prompted to answer using that context.
 */

function pickModel(): string {
  if (process.env.ANTHROPIC_API_KEY) return "claude-sonnet-4-5-20250929";
  if (process.env.OPENAI_API_KEY) return "gpt-4o-mini";
  if (process.env.OPENROUTER_API_KEY) return "openai/gpt-4o-mini";
  throw new Error("Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or OPENROUTER_API_KEY in .env.");
}

async function setupWorkspace(): Promise<string> {
  const cwd = join(process.cwd(), "workspace");
  await mkdir(join(cwd, ".theokit"), { recursive: true });
  await writeFile(
    join(cwd, "facts.md"),
    "# Project facts\nThe magic-number for this project is 8675309.\nThe coffee tap is broken since Tuesday.\n",
  );
  await writeFile(
    join(cwd, ".theokit", "context.json"),
    JSON.stringify(
      {
        sources: [{ name: "project-facts", path: "facts.md" }],
        maxTokens: 1000,
      },
      null,
      2,
    ),
  );
  return cwd;
}

async function main(): Promise<void> {
  const cwd = await setupWorkspace();
  const agent = await Agent.create({
    apiKey: process.env.THEOKIT_API_KEY ?? "user-real-example-key",
    model: { id: pickModel() },
    local: { cwd, settingSources: ["project"] },
    context: { manager: "file" },
  });

  if (agent.context !== undefined) {
    const snapshot = await agent.context.snapshot();
    console.log("Context snapshot:");
    for (const src of snapshot.sources) {
      console.log(`  - ${src.name} (${src.status}) ${src.path}`);
    }
    console.log(`  Budget tokens: ${snapshot.budget.maxTokens ?? "unbounded"}`);
  }

  const run = await agent.send(
    "Use the loaded project context to answer in one sentence: what is the magic-number?",
  );
  const result = await run.wait();
  console.log(`\n${result.result}`);
}

main().catch((cause) => {
  console.error("context-manager failed:", cause);
  process.exit(1);
});
