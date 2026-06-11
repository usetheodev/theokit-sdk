/**
 * Production-Readiness #1 — ConversationStorageAdapter example.
 *
 * Demonstrates:
 * - Custom adapter via InMemoryConversationStorage (zero infra dependency)
 * - Hands-on view of D325 / EC-3: strict resume integrity check
 * - The marker pattern that prevents silent Postgres history loss
 *
 * To run with a real LLM:
 *   OPENROUTER_API_KEY=sk-or-... pnpm run
 *
 * To use Postgres in your own code: see docs/recipes/conversation-storage-postgres.md.
 */

import {
  Agent,
  AgentRunError,
  ConfigurationError,
  InMemoryConversationStorage,
} from "@theokit/sdk";

const apiKey = process.env.OPENROUTER_API_KEY ?? "theo_test_conversation_storage_example";
const realLlm = apiKey.startsWith("sk-or-");

console.log(`\n== ConversationStorageAdapter example ==`);
console.log(realLlm ? "Mode: real OpenRouter" : "Mode: fixture (no LLM call)");
console.log();

const storage = new InMemoryConversationStorage();

// Unique agent id per run so repeated invocations don't clash with the
// persistent metadata registry at .theokit/agents/registry.json.
const agentId = `demo-conv-store-${Date.now().toString(36)}`;

// When using OPENROUTER, declare the provider route so the SDK doesn't
// look up OPENAI_API_KEY from env.
const providers = realLlm
  ? {
      routes: [{ capability: "chat" as const, provider: "openrouter" }],
      fallback: ["openrouter"],
    }
  : undefined;

// ── 1. Create with custom storage ────────────────────────────────────────
const agent = await Agent.create({
  apiKey,
  model: { id: "openai/gpt-4o-mini" },
  agentId,
  conversationStorage: storage,
  ...(providers !== undefined ? { providers } : {}),
});

console.log(`[1] Agent created with InMemoryConversationStorage`);
console.log(`    Storage state: ${(await storage.listConversationIds?.())?.length ?? 0} conversations`);

// ── 2. Send (only if real LLM) ──────────────────────────────────────────
if (realLlm) {
  const run = await agent.send("Reply with exactly: ACK");
  // Consume the stream first to drive the conversation forward; then wait().
  let text = "";
  for await (const event of run.stream()) {
    if (event.type === "assistant") {
      for (const part of event.message.content) {
        if (part.type === "text") text += part.text;
      }
    }
  }
  await run.wait();
  console.log(`[2] LLM replied: ${text.slice(0, 100)}`);
} else {
  console.log(`[2] Skipping LLM call (no OPENROUTER_API_KEY set)`);
}

const msgs = await storage.getMessages(agentId);
console.log(`    Storage now has: ${msgs.length} messages persisted`);
await agent.dispose();

// ── 3. Resume without storage → strict throw (EC-3) ─────────────────────
try {
  await Agent.resume(agentId, { apiKey });
  console.log(`[3] (unexpected) resume without storage succeeded`);
  process.exit(1);
} catch (err) {
  if (err instanceof ConfigurationError && err.code === "conversation_storage_required") {
    console.log(`[3] ✓ Strict resume rejected (D325): code="${err.code}"`);
    console.log(`    Reason: ${err.message.slice(0, 100)}...`);
  } else {
    throw err;
  }
}

// ── 4. Resume with storage → succeeds ────────────────────────────────────
const resumed = await Agent.resume(agentId, {
  apiKey,
  conversationStorage: storage,
});
console.log(`[4] ✓ Resume with storage succeeded: agentId=${resumed.agentId}`);
await resumed.dispose();

// ── 5. Show error code branching with AgentRunError ─────────────────────
console.log();
console.log(`AgentRunError discriminated codes available for switch:`);
const exampleCodes = [
  "auth_failed",
  "rate_limit",
  "quota_exceeded",
  "tool_runtime_error",
  "aborted",
];
for (const code of exampleCodes) {
  const e = new AgentRunError("demo", { code });
  console.log(`  - ${code.padEnd(20)} retriable=${e.retriable}`);
}

console.log();
console.log(`Done. See docs/recipes/conversation-storage-postgres.md for the Postgres adapter.`);
