/**
 * Sessions (v4.0) — native session persistence + `--continue`.
 *
 * A local agent's conversation IS a native Claude Code `.jsonl` transcript on disk at
 * `<baseDir>/projects/<encoded-cwd>/<agentId>.jsonl`. There is no pluggable storage adapter and no
 * session-metadata API — the transcript is the single source of truth. Set `local.baseDir` to
 * `~/.claude` and the Claude Code CLI can `--continue` the very same session.
 *
 * This example: create → send (plant a fact) → dispose → resume the SAME agentId → the model recalls
 * the fact across a simulated restart, and we print the on-disk transcript path.
 *
 * Requires a real LLM (recall proves the resume actually rehydrated the transcript):
 *   OPENROUTER_API_KEY=sk-or-... pnpm run
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Agent } from "@theokit/sdk";
import { transcriptPath } from "@theokit/sdk/persistence";

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey?.startsWith("sk-or-")) {
  console.log("Set OPENROUTER_API_KEY=sk-or-... to run this example (real LLM required for recall).");
  process.exit(0);
}

// Isolated base dir so repeated runs don't collide. In real usage: default `~/.theokit`,
// or `~/.claude` for Claude Code CLI `--continue` interop.
const baseDir = mkdtempSync(join(tmpdir(), "theokit-sessions-"));
const cwd = process.cwd();
const agentId = `agent-sessions-${Date.now().toString(36)}`;

const providers = { routes: [{ capability: "chat" as const, provider: "openrouter" }] };

// ── 1. Create + send (plant a fact) ──────────────────────────────────────
const agent = await Agent.create({
  apiKey,
  model: { id: "openai/gpt-4o-mini" },
  agentId,
  systemPrompt: "You are concise. Remember facts the user tells you.",
  local: { cwd, baseDir },
  providers,
});
const first = await (
  await agent.send("Remember my favorite color is teal. Reply with just: OK.")
).wait();
if (first.status !== "finished") {
  console.error("first send did not finish:", JSON.stringify(first.error ?? first.status));
  process.exit(1);
}
console.log(`[1] Sent + persisted. Transcript: ${transcriptPath(baseDir, cwd, agentId)}`);
await agent.dispose(); // flush transcript writes to disk

// ── 2. Resume the SAME agentId (simulated restart) → recall ──────────────
const resumed = await Agent.resume(agentId, {
  apiKey,
  model: { id: "openai/gpt-4o-mini" },
  local: { cwd, baseDir },
  providers,
});
const recall = await (
  await resumed.send("What is my favorite color? Reply with just the color.")
).wait();
await resumed.dispose();

if (recall.status !== "finished") {
  console.error("recall send did not finish:", JSON.stringify(recall.error ?? recall.status));
  process.exit(1);
}
const answer = String(recall.result);
console.log(`[2] Resumed + recalled across restart: "${answer.trim()}"`);

// ── validate: the resumed agent recalled the fact from the native transcript ──
if (!answer.toLowerCase().includes("teal")) {
  console.error(`Recall failed — expected "teal", got: ${answer}`);
  process.exit(1);
}
console.log("[3] OK — native session persisted and `--continue` recalled the fact.");
