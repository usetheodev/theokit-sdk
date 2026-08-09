// Victim script for persistence chaos testing (ADR D37).
//
// Spawned by `chaos-persistence.sh` as a child node process. Creates a
// local agent in a fresh workspace, sends 10 messages in a loop with
// short delays. Parent sends SIGKILL at a random point. We need the
// on-disk registry.json to remain parseable JSON after the kill.

// The import below used to go through the hardcoded absolute path of one developer's checkout,
// which does not exist — this script was broken on every machine, including the one that wrote it.
import { Agent } from "../packages/sdk/dist/index.js";

const cwd = process.argv[2] ?? process.cwd();
const agentId = `chaos-victim-${process.pid}`;

const agent = await Agent.create({
  agentId,
  apiKey: "theo_test_chaos",
  model: { id: "claude-sonnet-4-6" },
  local: { cwd },
});

for (let i = 0; i < 10; i += 1) {
  try {
    const run = await agent.send(`message ${i}`);
    await run.wait();
  } catch {
    // Best-effort. Parent will kill us mid-iteration.
  }
  await new Promise((r) => setTimeout(r, 200));
}

await agent.dispose();
