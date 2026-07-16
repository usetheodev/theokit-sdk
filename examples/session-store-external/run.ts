/**
 * External SessionStore (SE41) — resume from your own store (serverless / multi-host).
 *
 * By default a local agent's session is the native `.jsonl` transcript on disk. On serverless
 * (ephemeral FS) or multi-pod deploys, disk does not persist across invocations nor is it shared
 * across hosts. Inject `local.sessionStore` — a minimal 2-method store (`readRecords` /
 * `appendRecords`) over the SAME native `SessionRecord` shape — so an external backend (Postgres,
 * Redis, a KV, a durable object) is the PRIMARY store and the resume source.
 *
 * This example uses an in-memory `Map` in place of a real DB (the shape is identical: read all
 * records for an agentId; append the new-turn delta). It plants a fact, simulates a cold restart,
 * resumes from the store, and the model recalls the fact — with no local FS involved.
 *
 * Requires a real LLM (recall proves the resume rehydrated from the store):
 *   OPENROUTER_API_KEY=sk-or-... pnpm run
 */
import { Agent } from "@theokit/sdk";
import type { SessionRecord, SessionStore } from "@theokit/sdk";

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey?.startsWith("sk-or-")) {
  console.log("Set OPENROUTER_API_KEY=sk-or-... to run this example (real LLM required for recall).");
  process.exit(0);
}

// A real SessionStore backed by a Map — swap this for a Postgres/Redis-backed impl in production.
// Postgres sketch: readRecords = SELECT record FROM sessions WHERE agent_id=$1 ORDER BY seq;
//                  appendRecords = INSERT the delta rows (append-only, ordered).
class MapSessionStore implements SessionStore {
  private readonly byAgent = new Map<string, SessionRecord[]>();
  async readRecords(agentId: string): Promise<SessionRecord[]> {
    return [...(this.byAgent.get(agentId) ?? [])];
  }
  async appendRecords(agentId: string, records: readonly SessionRecord[]): Promise<void> {
    this.byAgent.set(agentId, [...(this.byAgent.get(agentId) ?? []), ...records]);
  }
}

const store = new MapSessionStore();
const cwd = process.cwd();
const agentId = `agent-external-${Date.now().toString(36)}`;
const providers = { routes: [{ capability: "chat" as const, provider: "openrouter" }] };

// ── 1. "Process 1": create with the external store + plant a fact ─────────
const first = await Agent.create({
  apiKey,
  model: { id: "openai/gpt-4o-mini" },
  agentId,
  systemPrompt: "You are concise. Remember facts the user tells you.",
  local: { cwd, sessionStore: store },
  providers,
});
const r1 = await (
  await first.send("Remember my project's deploy region is sa-east-1. Reply with just: OK.")
).wait();
if (r1.status !== "finished") {
  console.error("first send did not finish:", JSON.stringify(r1.error ?? r1.status));
  process.exit(1);
}
await first.dispose();
console.log(`[1] Persisted to the external store (${(await store.readRecords(agentId)).length} records).`);

// ── 2. "Process 2": a fresh handle resumes from the SAME store ────────────
// (No local FS carried the history — only `store` did. On serverless this is a new invocation.)
const resumed = await Agent.resume(agentId, {
  apiKey,
  model: { id: "openai/gpt-4o-mini" },
  local: { cwd, sessionStore: store },
  providers,
});
const recall = await (
  await resumed.send("What is my project's deploy region? Reply with just the region.")
).wait();
await resumed.dispose();

if (recall.status !== "finished") {
  console.error("recall send did not finish:", JSON.stringify(recall.error ?? recall.status));
  process.exit(1);
}
const answer = String(recall.result);
console.log(`[2] Resumed from the external store + recalled: "${answer.trim()}"`);

// ── validate: recall came from the external store ────────────────────────
if (!answer.toLowerCase().includes("sa-east-1")) {
  console.error(`Recall failed — expected "sa-east-1", got: ${answer}`);
  process.exit(1);
}
console.log("[3] OK — external SessionStore is the primary store AND resume source.");
