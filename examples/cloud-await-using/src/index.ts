import { Agent } from "@usetheo/sdk";

/**
 * `await using` on CloudAgent (ADR D5).
 *
 * `Symbol.asyncDispose` is declared on the public `SDKAgent` interface,
 * so `await using` works identically on Local and Cloud agents. Companion
 * to `one-shot-prompt` (which uses Local).
 *
 * `CloudAgent.dispose()` is idempotent (ADR D15 EC-3): even if the `using`
 * exit hook fires AND user code explicitly calls `agent.dispose()`, the
 * dispose side-effect runs exactly once.
 */
async function main(): Promise<void> {
  console.log("Pattern A: `await using` — automatic dispose at scope exit.\n");
  {
    await using agent = await Agent.create({
      apiKey: process.env.THEOKIT_API_KEY ?? "theo_test_cloud_await_using",
      model: { id: "google/gemini-2.0-flash-exp:free" },
      cloud: { repos: [{ url: "https://github.com/usetheo/example" }] },
    });
    console.log(`  cloud agent ${agent.agentId} alive inside the using block`);
  }
  // At this point the agent is disposed.
  console.log("  ✓ scope exit → agent disposed automatically\n");

  console.log("Pattern B: explicit dispose() — same idempotent behavior.\n");
  const agent = await Agent.create({
    apiKey: "theo_test_cloud_await_using_b",
    model: { id: "google/gemini-2.0-flash-exp:free" },
    cloud: { repos: [{ url: "https://github.com/usetheo/example" }] },
  });
  console.log(`  cloud agent ${agent.agentId} created`);
  await agent.dispose();
  await agent.dispose(); // idempotent (EC-3) — no-op
  await agent.dispose(); // idempotent again
  console.log("  ✓ called dispose() 3 times — runs once, subsequent calls no-op");

  console.log("\nRecommendation: prefer `await using` over explicit dispose() for resource safety.");
}

main().catch((cause) => {
  console.error("cloud-await-using failed:", cause);
  process.exit(1);
});
