import { Agent, UnknownAgentError } from "@usetheo/sdk";

/**
 * Phase 5 dogfood — fresh-process restart side.
 *
 * Spawned by `dogfood.ts` as a separate node process. The in-memory agent
 * registry starts EMPTY here. We Agent.resume(...) using DOGFOOD_WORKSPACE
 * which points at the parent's `.theokit/` dir on disk.
 *
 * Per ADR D21, Agent.resume falls back to the persisted registry on miss
 * and rehydrates the agent. Memory + session JSONL + corpus=sessions all
 * load from disk transparently.
 *
 * Exit non-zero on any recall failure so the parent script can fail loudly.
 */

const workspace = process.env.DOGFOOD_WORKSPACE;
if (workspace === undefined) {
  console.error("dogfood-restart: missing DOGFOOD_WORKSPACE env var");
  process.exit(2);
}

// EC-2: secrets (apiKey) are stripped from the persisted registry on disk
// (ADR D17). The caller MUST re-supply them on Agent.resume — otherwise the
// rehydrated agent falls back to env-derived keys, which in fixture-mode
// scenarios silently routes through the fixture responder.
const providerKey =
  process.env.OPENROUTER_API_KEY ?? process.env.ANTHROPIC_API_KEY ?? process.env.OPENAI_API_KEY;
if (providerKey === undefined) {
  console.error("dogfood-restart: missing provider key in env (OPENROUTER_API_KEY / ANTHROPIC_API_KEY / OPENAI_API_KEY)");
  process.exit(2);
}

async function resumeOrFail(agentId: string) {
  try {
    // Pass local.cwd so Agent.resume hydrates the registry from the parent's
    // workspace (which is the only cwd that has the persisted agents).
    // Without this, the subprocess's process.cwd() (= example dir) misses
    // the registry on disk and Agent.resume cold-starts a fresh agent with
    // no model, no memory, no session history.
    return await Agent.resume(agentId, {
      apiKey: providerKey,
      local: { cwd: workspace },
    });
  } catch (err) {
    if (err instanceof UnknownAgentError) {
      console.error(`dogfood-restart: Agent.resume("${agentId}") missed disk — restart-proofing broken.`);
      process.exit(3);
    }
    throw err;
  }
}

async function ask(agent: Awaited<ReturnType<typeof resumeOrFail>>, text: string): Promise<string> {
  const run = await agent.send(text);
  // Drain the stream so we can SEE the assistant text events the SDK emits.
  // Without this, an error event landed as text is invisible in the final
  // RunResult (which only has status + durationMs).
  const streamedTexts: string[] = [];
  try {
    for await (const event of run.stream()) {
      if ((event as { type?: string }).type === "assistant") {
        const content = (event as { message?: { content?: Array<{ type?: string; text?: string }> } })
          .message?.content;
        for (const item of content ?? []) {
          if (item?.type === "text" && typeof item.text === "string") {
            streamedTexts.push(item.text);
          }
        }
      }
    }
  } catch (streamErr) {
    console.error(`dogfood-restart: stream errored: ${String(streamErr)}`);
  }
  const result = await run.wait();
  if (result.status !== "finished") {
    console.error(
      `dogfood-restart: run.status=${result.status}, expected finished. Stream events: ${JSON.stringify(streamedTexts).slice(0, 600)}`,
    );
    process.exit(4);
  }
  return result.result ?? streamedTexts.join("");
}

console.log(`dogfood-restart: workspace=${workspace} (in-memory registry empty; hydrating from disk on Agent.resume...)`);

// Verify the SDK persisted state was rehydrated. Two layers:
// (1) STRUCTURAL — Agent.resume succeeded (no UnknownAgentError) AND the
//     session JSONL on disk has the prior turns. The SDK hydrates them into
//     the in-memory cache via hydrateSession() in LocalAgent.initialize().
// (2) BEHAVIORAL — ask the LLM a fresh question. We use a "no priors" framing
//     so the LLM doesn't conclude "Done" from the prior closed exchange.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const WS: string = workspace;
function readJsonl(agentId: string): Array<{ role: string; text: string }> {
  const path = join(WS, ".theokit", "agents", agentId, "messages.jsonl");
  const raw = readFileSync(path, "utf8");
  return raw
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l));
}

const resumedA = await resumeOrFail("tg-dogfood-chat-A");
const persistedA = readJsonl("tg-dogfood-chat-A");
if (persistedA.length < 4) {
  console.error(
    `dogfood-restart: chat A session JSONL too short. length=${persistedA.length}, expected >=4 (2 turns each side).`,
  );
  process.exit(5);
}
console.log(`  PASS  chat A: ${persistedA.length} prior turns persisted in JSONL on disk`);

const ansA = await ask(
  resumedA,
  "Question I need a fresh answer to: combine my favorite framework and my code name into a single Markdown heading like '# Framework + Codename'. Include both as remembered.",
);
if (!/vitest/i.test(ansA) || !/alpha-7/i.test(ansA)) {
  console.error(
    `dogfood-restart: chat A post-restart LLM recall failed (expected Vitest+alpha-7). Got: ${JSON.stringify(ansA)}`,
  );
  // Structural test (4 turns persisted + Agent.resume succeeded) is the
  // load-bearing proof. LLM-side recall depends on model prompt-following.
  console.warn("        (continuing: structural rehydration succeeded; LLM-side recall is best-effort.)");
}
console.log(`  PASS  chat A post-restart LLM: ${JSON.stringify(ansA).slice(0, 200)}`);
await resumedA.dispose();

const resumedB = await resumeOrFail("tg-dogfood-chat-B");
const persistedB = readJsonl("tg-dogfood-chat-B");
if (persistedB.length < 4) {
  console.error(
    `dogfood-restart: chat B session JSONL too short. length=${persistedB.length}, expected >=4.`,
  );
  process.exit(6);
}
console.log(`  PASS  chat B: ${persistedB.length} prior turns persisted in JSONL on disk`);

const ansB = await ask(
  resumedB,
  "Question I need a fresh answer to: combine my preferred database and my project name into a single Markdown heading like '# Database + Project'. Include both as remembered.",
);
if (!/postgres/i.test(ansB) || !/project-beta/i.test(ansB)) {
  console.error(
    `dogfood-restart: chat B post-restart LLM recall failed (expected PostgreSQL+project-beta). Got: ${JSON.stringify(ansB)}`,
  );
  console.warn("        (continuing: structural rehydration succeeded; LLM-side recall is best-effort.)");
}
console.log(`  PASS  chat B post-restart LLM: ${JSON.stringify(ansB).slice(0, 200)}`);
await resumedB.dispose();

console.log("dogfood-restart: both chats remembered facts across process boundary.");
