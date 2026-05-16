import { Agent } from "@usetheo/sdk";

/**
 * `local: { force: true }` — when a previous run on the same local agent
 * is stuck (status "running" but no longer making progress), `force: true`
 * on the next send expires the stuck run so the new message can proceed.
 *
 * Without `force`, a stuck run would block subsequent sends (or surface
 * a state error depending on runtime). With `force`, the SDK transitions
 * the stuck run to "cancelled" and starts the new one.
 */
async function main(): Promise<void> {
  const agent = await Agent.create({
    apiKey: process.env.THEOKIT_API_KEY ?? "theo_test_local_force",
    model: { id: "google/gemini-2.0-flash-exp:free" },
    local: { cwd: process.cwd() },
  });

  console.log(`Agent created: ${agent.agentId}`);

  // First send — normal path
  const first = await agent.send("First message.");
  const firstResult = await first.wait();
  console.log(`First send: status=${firstResult.status}`);

  // Second send WITH force expire — even if the first run had been stuck,
  // this would proceed. Demonstrates the option shape; fixture mode just
  // completes both runs normally.
  const second = await agent.send("Second message after force-expire.", {
    local: { force: true },
  });
  const secondResult = await second.wait();
  console.log(`Second send (force: true): status=${secondResult.status}`);

  await agent.dispose();
  console.log("\nUse `local: { force: true }` in production when an agent's previous run is stuck.");
}

main().catch((cause) => {
  console.error("local-force-expire failed:", cause);
  process.exit(1);
});
