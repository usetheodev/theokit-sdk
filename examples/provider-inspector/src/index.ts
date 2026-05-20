import { Agent, Theokit } from "@usetheo/sdk";

/**
 * Provider inspector. Demonstrates the two complementary surfaces:
 *
 *   - `Theokit.providers.list()`     — global catalog (every provider known
 *                                       to the platform, with capability +
 *                                       availability + setup schema).
 *   - `agent.providers.routes()`     — per-agent resolved routes (which
 *                                       provider serves each capability for
 *                                       THIS agent + why).
 *
 * Requires:
 *   - THEOKIT_API_KEY (fixture `theo_test_*` or real PaaS key) for the catalog.
 *   - One of ANTHROPIC/OPENAI/OPENROUTER_API_KEY for `agent.providers.routes()`.
 */

function pickProvider(): { name: "anthropic" | "openai" | "openrouter"; model: string } {
  if (process.env.ANTHROPIC_API_KEY) return { name: "anthropic", model: "claude-sonnet-4-5-20250929" };
  if (process.env.OPENAI_API_KEY) return { name: "openai", model: "gpt-4o-mini" };
  if (process.env.OPENROUTER_API_KEY) return { name: "openrouter", model: "openai/gpt-4o-mini" };
  throw new Error("Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or OPENROUTER_API_KEY in .env.");
}

async function main(): Promise<void> {
  console.log("=== Global catalog (Theokit.providers.list) ===\n");
  const catalog = await Theokit.providers.list();
  for (const provider of catalog) {
    console.log(`- ${provider.name} (${provider.displayName})`);
    console.log(`    capabilities: ${provider.capabilities.join(", ")}`);
    console.log(`    available:    ${provider.isAvailable}`);
  }

  console.log("\n=== Per-agent routes (agent.providers.routes) ===\n");
  const { name, model } = pickProvider();
  const agent = await Agent.create({
    apiKey: process.env.THEOKIT_API_KEY ?? "user-real-example-key",
    model: { id: model },
    local: { cwd: process.cwd() },
    providers: {
      routes: [{ capability: "chat", provider: name }],
    },
  });

  const routes = (await agent.providers?.routes()) ?? [];
  if (routes.length === 0) {
    console.log("(no resolved routes — agent.providers may be undefined for this config)");
  } else {
    for (const route of routes) {
      console.log(`- capability=${route.capability}  provider=${route.provider}`);
      if (route.model !== undefined) console.log(`    model:  ${route.model}`);
      console.log(`    reason: ${route.reason}`);
    }
  }

  console.log("\nReason values:");
  console.log("  explicit-model-provider       — the model id pins the provider");
  console.log("  explicit-route                — your providers.routes config picked it");
  console.log("  first-available-plugin-provider — a plugin contributed this provider");

  await agent.dispose();
}

main().catch((cause) => {
  console.error("provider-inspector failed:", cause);
  process.exit(1);
});
