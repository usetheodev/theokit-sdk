import { Agent } from "@usetheo/sdk";

/**
 * Provider fallback example. Configures a routes/fallback chain
 * via `AgentOptions.providers`. If the primary is unreachable,
 * the SDK falls through to the next entry.
 *
 * To exercise the fallback path: set the primary's API key to an
 * invalid value while keeping the fallback's key valid.
 */

async function main(): Promise<void> {
  if (process.env.OPENROUTER_API_KEY === undefined) {
    throw new Error("This example requires OPENROUTER_API_KEY in .env (used as fallback).");
  }

  // Intentionally point primary at Anthropic with a bogus key so the
  // fallback (OpenRouter) is exercised. If you have a valid Anthropic
  // key, comment this line out to see the primary succeed.
  process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "sk-ant-bogus-for-fallback-demo";

  const agent = await Agent.create({
    apiKey: process.env.THEOKIT_API_KEY ?? "user-real-example-key",
    model: { id: "openai/gpt-4o-mini" },
    local: { cwd: process.cwd() },
    providers: {
      routes: [{ provider: "anthropic", capabilities: ["chat"] }],
      fallback: ["openrouter"],
    },
  });
  console.log(`Agent ${agent.agentId} created with anthropic→openrouter fallback`);

  const run = await agent.send("Reply with exactly the word: routed");
  const result = await run.wait();
  console.log(`\nstatus=${result.status} result=${JSON.stringify(result.result)}`);
}

main().catch((cause) => {
  console.error("provider-fallback failed:", cause);
  process.exit(1);
});
