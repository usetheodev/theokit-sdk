import { Agent } from "@usetheo/sdk";

/**
 * SendOptions per-call overrides. The same agent handle dispatches
 * three runs:
 *   1. Default (agent-level model + systemPrompt only).
 *   2. Per-call `systemPrompt` override.
 *   3. Per-call `model` override (sticky — the agent.model field updates).
 *
 * Prints each result so you can see the persona/model shift across calls.
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
    systemPrompt: "You are a JSON-only API. Reply with a JSON object {\"answer\": string}.",
  });
  console.log(`agent ${agent.agentId} created — default model ${agent.model?.id}`);

  // Run 1: defaults.
  const a = await (await agent.send("What is 2+2?")).wait();
  console.log(`\n[1 default] ${a.result}`);

  // Run 2: per-call systemPrompt override.
  const b = await (
    await agent.send("What is 2+2?", {
      systemPrompt: "You are a poet. Reply with a single rhyming couplet, no JSON.",
    })
  ).wait();
  console.log(`\n[2 systemPrompt override]\n${b.result}`);

  // Run 3: per-call model override (sticky).
  const altModel = pickModel() === "openai/gpt-4o-mini" ? "openai/gpt-3.5-turbo" : pickModel();
  const c = await (await agent.send("Reply with the exact word: switched", { model: { id: altModel } })).wait();
  console.log(`\n[3 model override → ${altModel}] ${c.result}`);
  console.log(`\nAfter override, agent.model is now: ${agent.model?.id}`);
}

main().catch((cause) => {
  console.error("send-overrides failed:", cause);
  process.exit(1);
});
