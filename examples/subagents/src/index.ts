import { Agent } from "@usetheo/sdk";

/**
 * Subagents defined inline via `AgentOptions.agents`. The main agent
 * sees them in its tool list and can spawn one. Each subagent has
 * its OWN `prompt` (system context) — they do NOT inherit the parent's
 * `systemPrompt`.
 *
 * Two subagents are declared: `reviewer` (security focus) and
 * `tester` (test coverage focus). The main agent is prompted to
 * spawn them.
 */

function pickModel(): string {
  if (process.env.ANTHROPIC_API_KEY) return "claude-sonnet-4-5-20250929";
  if (process.env.OPENAI_API_KEY) return "gpt-4o-mini";
  if (process.env.OPENROUTER_API_KEY) return "openai/gpt-4o-mini";
  throw new Error("Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or OPENROUTER_API_KEY in .env.");
}

async function main(): Promise<void> {
  const agent = await Agent.create({
    apiKey: process.env.THEOKIT_API_KEY ?? "user-real-example-key",
    model: { id: pickModel() },
    local: { cwd: process.cwd() },
    systemPrompt: "You are a tech lead. You can spawn the `reviewer` and `tester` subagents to help.",
    agents: {
      reviewer: {
        description: "Reviews code for security issues and bugs.",
        prompt: "You are a security-focused code reviewer. Be terse and direct.",
        model: "inherit",
      },
      tester: {
        description: "Writes test cases for code changes.",
        prompt: "You are a test engineer. Suggest test cases as a bullet list.",
        model: "inherit",
      },
    },
  });
  console.log(`Agent ${agent.agentId} created with 2 subagents`);

  const run = await agent.send(
    "List the two subagents you can spawn, by name only, separated by commas. Don't actually spawn them.",
  );
  const result = await run.wait();
  console.log(`\n${result.result}`);
}

main().catch((cause) => {
  console.error("subagents failed:", cause);
  process.exit(1);
});
