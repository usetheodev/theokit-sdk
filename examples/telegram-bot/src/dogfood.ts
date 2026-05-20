import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { Agent } from "@usetheo/sdk";

/**
 * Phase 5 dogfood — chat assistant readiness with a REAL LLM.
 *
 * Simulates the Telegram bot pattern WITHOUT a Telegram token so the gate
 * can run unattended:
 *   1. Two distinct "chats" (different agentIds) on the same workspace cwd.
 *   2. Each chat says "Remember: <fact>" and asks a follow-up.
 *   3. **Real process restart**: spawn a fresh node process via tsx that
 *      runs `dogfood-restart.ts`, which re-Agent.resume()s both chats and
 *      verifies memory recall after restart.
 *   4. Back in the parent: concurrent burst (5 sends) into one chat to
 *      assert role-alternation linearity.
 *   5. Confirm session-corpus files exist on disk.
 *
 * Requirements: a real provider key in .env (OPENROUTER_API_KEY works on
 * the free tier with the default model).
 */

const apiKey = process.env.THEOKIT_API_KEY ?? process.env.OPENROUTER_API_KEY;
const providerKey =
  process.env.OPENROUTER_API_KEY ?? process.env.ANTHROPIC_API_KEY ?? process.env.OPENAI_API_KEY;
if (apiKey === undefined || apiKey.length === 0 || apiKey.startsWith("theo_test_")) {
  console.error(
    "dogfood: THEOKIT_API_KEY must be a real (non-fixture) key. Set OPENROUTER_API_KEY in .env and re-run.",
  );
  process.exit(1);
}
if (providerKey === undefined) {
  console.error(
    "dogfood: need OPENROUTER_API_KEY (or ANTHROPIC_API_KEY / OPENAI_API_KEY) in .env to call a real LLM.",
  );
  process.exit(1);
}

const workspace = process.env.DOGFOOD_WORKSPACE ?? mkdtempSync(join(tmpdir(), "theokit-dogfood-tg-"));
console.log(`dogfood: workspace cwd = ${workspace}`);

const SUCCESSES: string[] = [];
const WARNINGS: string[] = [];
function passed(label: string): void {
  SUCCESSES.push(label);
  console.log(`  PASS  ${label}`);
}
function failed(label: string, detail: string): never {
  console.error(`  FAIL  ${label} — ${detail}`);
  process.exit(1);
}
function warned(label: string, detail: string): void {
  WARNINGS.push(`${label}: ${detail}`);
  console.warn(`  WARN  ${label} — ${detail}`);
}
function expectExists(path: string, label: string): void {
  try {
    statSync(path);
    passed(`${label} (${path})`);
  } catch (cause) {
    failed(label, `file not found: ${path} (${String(cause)})`);
  }
}

async function createBotAgent(agentId: string) {
  return Agent.create({
    agentId,
    apiKey,
    model: { id: "google/gemini-2.0-flash-001" },
    local: { cwd: workspace },
    memory: {
      enabled: true,
      namespace: "dogfood-tg",
      scope: "user",
      userId: agentId,
      activeRecall: { enabled: true, queryMode: "recent" },
    },
    systemPrompt:
      "You are a personal assistant. Be concise (1-2 sentences). Always remember user preferences exactly when asked.",
  });
}

async function ask(agent: Awaited<ReturnType<typeof createBotAgent>>, text: string): Promise<string> {
  const run = await agent.send(text);
  const result = await run.wait();
  if (result.status !== "finished") {
    failed("LLM call", `run.status=${result.status}, result=${String(result.result).slice(0, 200)}`);
  }
  return result.result ?? "";
}

console.log("\n[1/5] Two chats, each says Remember + follow-up...");
const chatA = await createBotAgent("tg-dogfood-chat-A");
const chatB = await createBotAgent("tg-dogfood-chat-B");
await ask(chatA, "Remember: my favorite framework is Vitest. Also remember my code name is alpha-7.");
const ansA1 = await ask(chatA, "What's my favorite framework and code name?");
if (!/vitest/i.test(ansA1) || !/alpha-7/i.test(ansA1)) {
  failed("chat A in-process recall", `expected Vitest+alpha-7 in: ${JSON.stringify(ansA1)}`);
}
passed("chat A: in-process recall");

await ask(chatB, "Remember: my preferred database is PostgreSQL and my project is project-beta.");
const ansB1 = await ask(chatB, "What's my preferred database and project name?");
if (!/postgres/i.test(ansB1) || !/project-beta/i.test(ansB1)) {
  failed("chat B in-process recall", `expected postgres+project-beta in: ${JSON.stringify(ansB1)}`);
}
passed("chat B: in-process recall");

await chatA.dispose();
await chatB.dispose();
passed("dispose flushed registry + sessions to disk");

console.log("\n[2/5] Inspect persisted state...");
expectExists(join(workspace, ".theokit", "agents", "registry.json"), "registry.json");
expectExists(
  join(workspace, ".theokit", "agents", "tg-dogfood-chat-A", "messages.jsonl"),
  "chat A messages.jsonl",
);
expectExists(
  join(workspace, ".theokit", "agents", "tg-dogfood-chat-B", "messages.jsonl"),
  "chat B messages.jsonl",
);
expectExists(join(workspace, ".theokit", "memory", "sessions"), "sessions corpus dir");

console.log("\n[3/5] REAL process restart: spawn fresh node + Agent.resume + re-ask...");
const restartScript = join(fileURLToPath(new URL(".", import.meta.url)), "dogfood-restart.ts");
const result = spawnSync(
  "npx",
  ["tsx", restartScript],
  {
    // Inherit the parent's env (already loaded via tsx --env-file=...).
    // No need to re-load .env in the child — DOGFOOD_WORKSPACE plus the
    // provider keys are already in process.env.
    env: { ...process.env, DOGFOOD_WORKSPACE: workspace },
    encoding: "utf8",
    stdio: "inherit",
  },
);
if (result.status !== 0) {
  failed("restart subprocess", `exit ${result.status}`);
}
passed("restart subprocess validated post-restart recall for both chats");

console.log("\n[4/5] Concurrent-burst (5 sends) into one chat: history stays linear...");
const burstAgent = await Agent.resume("tg-dogfood-chat-A", {
  apiKey,
  local: { cwd: workspace },
});
const burstRuns = await Promise.all(
  [1, 2, 3, 4, 5].map((i) =>
    burstAgent.send(`burst-${i}: in one word, what is ${i} squared (number only)?`),
  ),
);
await Promise.all(burstRuns.map((r) => r.wait()));
await burstAgent.dispose();
const jsonl = readFileSync(
  join(workspace, ".theokit", "agents", "tg-dogfood-chat-A", "messages.jsonl"),
  "utf8",
);
const records = jsonl
  .split("\n")
  .filter((l) => l.length > 0)
  .map((l) => JSON.parse(l) as { role: string; text: string });
const roles = records.map((r) => r.role);
for (let i = 0; i < roles.length - 1; i += 1) {
  if (roles[i] === roles[i + 1]) {
    failed("concurrent burst", `roles not alternating at index ${i}: ${roles.slice(0, i + 2).join(",")}`);
  }
}
passed(`concurrent burst: ${records.length} records, strictly alternating user/assistant`);

console.log("\n[5/5] Sessions corpus on disk...");
const sessionFiles = readdirSync(join(workspace, ".theokit", "memory", "sessions"));
if (sessionFiles.length < 5) {
  warned("session corpus count", `expected ≥5 finished-run summaries, found ${sessionFiles.length}`);
} else {
  passed(`session corpus: ${sessionFiles.length} summaries`);
}

console.log("\n────────────────────────────────────────────");
console.log(`DOGFOOD RESULT: ${SUCCESSES.length} pass, ${WARNINGS.length} warn, 0 fail`);
if (WARNINGS.length > 0) {
  console.log("Warnings:");
  for (const w of WARNINGS) console.log(`  - ${w}`);
}
console.log(`cleanup: rm -rf ${workspace}`);
rmSync(workspace, { recursive: true, force: true });
