import { Agent } from "@usetheo/sdk";

/**
 * Agent management surface. Once agents are created (local or cloud)
 * they're discoverable via the static management API:
 *
 *   - `Agent.list({ runtime?, limit?, cursor? })`
 *   - `Agent.get(agentId)`
 *   - `Agent.listRuns({ runtime?, ... })`
 *   - `Agent.getRun(runId, options)`
 *   - `Agent.archive(agentId)` / `Agent.unarchive(agentId)`
 *   - `Agent.delete(agentId)`
 *   - `Agent.resume(agentId)` to get a usable SDKAgent handle again
 *
 * This example uses fixture mode (`theo_test_*` key) so each call
 * returns deterministic data and the example runs without a backend.
 */

async function main(): Promise<void> {
  // Seed a couple of agents so we have something to manage.
  const a = await Agent.create({
    apiKey: process.env.THEOKIT_API_KEY ?? "theo_test_mgmt_demo",
    name: "alpha",
    model: { id: "google/gemini-2.0-flash-001" },
    local: { cwd: process.cwd() },
  });
  const b = await Agent.create({
    apiKey: process.env.THEOKIT_API_KEY ?? "theo_test_mgmt_demo",
    name: "beta",
    model: { id: "google/gemini-2.0-flash-001" },
    cloud: { repos: [{ url: "https://github.com/usetheo/example" }] },
  });
  console.log(`Seeded local=${a.agentId} cloud=${b.agentId}`);

  const list = await Agent.list();
  console.log(`\nAgent.list() returned ${list.items.length} agents:`);
  for (const info of list.items) {
    console.log(`  - ${info.agentId} (${info.runtime ?? "?"}) name="${info.name}" status=${info.status ?? "?"}`);
  }

  const got = await Agent.get(a.agentId);
  console.log(`\nAgent.get(${a.agentId}) → name="${got.name}" lastModified=${got.lastModified}`);

  await Agent.archive(b.agentId);
  console.log(`\nArchived ${b.agentId}`);
  const afterArchive = await Agent.get(b.agentId);
  console.log(`  archived=${afterArchive.archived}`);

  await Agent.unarchive(b.agentId);
  console.log(`Unarchived ${b.agentId}`);

  // Send one run on `a` so listRuns has something.
  const run = await a.send("Hello.");
  await run.wait();

  const runs = await Agent.listRuns(a.agentId);
  console.log(`\nAgent.listRuns(${a.agentId}) → ${runs.items.length} runs`);
  for (const r of runs.items) console.log(`  - ${r.id} status=${r.status}`);

  if (runs.items.length > 0 && runs.items[0] !== undefined) {
    const fetched = await Agent.getRun(runs.items[0].id);
    console.log(`\nAgent.getRun(${runs.items[0].id}) → agentId=${fetched.agentId} status=${fetched.status}`);
  }

  await Agent.delete(a.agentId);
  await Agent.delete(b.agentId);
  console.log(`\nDeleted both agents`);

  // DX helpers (ADRs D22, D25): builder + getOrCreate. Same semantics as the
  // raw create/resume above, just less boilerplate.
  const builderAgent = await Agent.builder()
    .apiKey(process.env.THEOKIT_API_KEY ?? "theo_test_mgmt_demo")
    .name("builder-demo")
    .model({ id: "google/gemini-2.0-flash-001" })
    .local({ cwd: process.cwd() })
    .create();
  console.log(`\nAgent.builder()...create() → ${builderAgent.agentId}`);

  // getOrCreate consolidates resume-or-create. Calling it twice returns the
  // same handle without throwing "already exists" on the second pass.
  const goCAgent = await Agent.getOrCreate(builderAgent.agentId, {
    apiKey: process.env.THEOKIT_API_KEY ?? "theo_test_mgmt_demo",
    model: { id: "google/gemini-2.0-flash-001" },
    local: { cwd: process.cwd() },
  });
  console.log(
    `Agent.getOrCreate(${builderAgent.agentId}) → reused=${goCAgent.agentId === builderAgent.agentId}`,
  );

  await builderAgent.dispose();
  await goCAgent.dispose();
  await Agent.delete(builderAgent.agentId);
}

main().catch((cause) => {
  console.error("agent-management failed:", cause);
  process.exit(1);
});
