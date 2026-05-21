/**
 * Telegram-Pro dogfood QA against Ollama backend (T8.1, ADR D190).
 *
 * Exercises the same SDK stack the bot uses (system prompt, custom tools,
 * subagents config, plugins, local runtime) but with
 * `TELEGRAM_PRO_MODEL=ollama/...` for fully-local operation.
 *
 * Run:
 *   ollama serve                      # in another terminal
 *   ollama pull llama3.2:3b
 *   TELEGRAM_PRO_MODEL=ollama/llama3.2:3b pnpm exec tsx src/dogfood-ollama.ts
 *
 * Pass criteria:
 *   - ≥ 1 turn returns non-empty assistant content (chat path works).
 *   - Process exits 0 with no unhandled rejection (lifecycle clean).
 *
 * Per `.claude/rules/real-llm-validation.md`.
 */

import { Agent } from "@usetheo/sdk";

// Note (edge-case review EC-P): the production SYSTEM_PROMPT +
// TELEGRAM_PRO_CUSTOM_TOOLS mix bilingual (pt-BR/en) instructions with
// 10+ tool descriptions. Small local models (≤7B) confuse easily on
// that complexity. This dogfood uses a STRIPPED system prompt to
// validate the SDK *stack* (provider routing, run lifecycle, streaming)
// against Ollama. The full telegram-pro experience requires a larger
// model (e.g. qwen2.5:14b, llama3.1:8b+, or a remote API).

const TURNS = [
  "Hi! In one short sentence, what does TypeScript add to JavaScript?",
  "Reply with the word DONE and nothing else.",
];

async function probeOllama(): Promise<boolean> {
  try {
    const r = await fetch(`${process.env.OLLAMA_HOST ?? "http://localhost:11434"}/api/tags`, {
      signal: AbortSignal.timeout(1000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  if (!(await probeOllama())) {
    console.error("[dogfood-ollama] Ollama not reachable. Run `ollama serve` first.");
    process.exit(0);
  }

  const modelId = process.env.TELEGRAM_PRO_MODEL ?? "ollama/llama3.2:3b";
  console.log(`model=${modelId}\n`);

  // Smoke the SDK stack (provider routing → D182, run lifecycle → loop,
  // streaming → SSE) against Ollama. No custom tools, no MCP — those
  // surfaces ship via examples/ollama-* (D190). EC-P: small models
  // can't handle telegram-pro's full prompt.
  const agent = await Agent.create({
    apiKey: process.env.THEOKIT_API_KEY ?? "local",
    model: { id: modelId },
    local: { cwd: process.cwd() },
    systemPrompt:
      "You are a concise assistant. Respond in one or two short sentences. Plain text, no markdown.",
  });

  let passed = 0;
  for (let i = 0; i < TURNS.length; i++) {
    const userText = TURNS[i]!;
    console.log(`[turn ${i + 1}] user: ${userText}`);
    try {
      const run = await agent.send(userText);
      let reply = "";
      for await (const event of run.stream()) {
        if (event.type === "assistant") {
          for (const part of event.message.content) {
            if (part.type === "text") reply += part.text;
          }
        }
      }
      await run.wait();
      console.log(`[turn ${i + 1}] bot : ${reply.slice(0, 200)}${reply.length > 200 ? "..." : ""}\n`);
      if (reply.trim().length > 0) passed += 1;
    } catch (cause) {
      console.error(`[turn ${i + 1}] FAILED:`, cause instanceof Error ? cause.message : cause);
    }
  }

  console.log(`Dogfood result: ${passed}/${TURNS.length} turns passed`);
  if (passed === 0) {
    console.error("FAIL — no turns produced output");
    process.exit(1);
  }
  console.log("PASS");
  process.exit(0);
}

main().catch((cause) => {
  console.error("[dogfood-ollama] unhandled:", cause);
  process.exit(1);
});
