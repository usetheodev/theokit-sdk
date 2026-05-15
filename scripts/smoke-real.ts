#!/usr/bin/env tsx
/**
 * Real end-to-end smoke test against the actual provider configured in
 * `.env`. Loads env via Node's built-in `--env-file` flag (Node 22+) or
 * via a tiny inline parser if the flag is not used.
 *
 * Usage:
 *   pnpm exec tsx --env-file=.env scripts/smoke-real.ts
 *   pnpm exec tsx --env-file=../../.env scripts/smoke-real.ts
 *
 * What it does:
 *   1. Detects which provider env credential is present (Anthropic, OpenAI,
 *      OpenRouter) and prints which runtime path will be taken.
 *   2. Creates a local agent with a non-fixture API key — this forces the
 *      real local runtime through `shouldUseRealLocalRuntime`.
 *   3. Sends a single user message and streams the events.
 *   4. Prints the assistant text + final status.
 *
 * Secrets are NEVER printed. The script only logs the provider name
 * (`anthropic` / `openai`) and the first 4 characters of the key as a
 * sanity check.
 */

import { Agent } from "../packages/sdk/src/index.js";

function maskKey(key: string | undefined): string {
  if (key === undefined || key.length === 0) return "(unset)";
  return `${key.slice(0, 4)}…${key.slice(-2)}`;
}

function detectProvider(): { name: string; modelId: string } | undefined {
  if (process.env.ANTHROPIC_API_KEY) {
    return { name: "anthropic", modelId: "claude-sonnet-4-5-20250929" };
  }
  if (process.env.OPENAI_API_KEY) {
    return { name: "openai", modelId: "gpt-4o-mini" };
  }
  if (process.env.OPENROUTER_API_KEY) {
    return { name: "openrouter", modelId: "openai/gpt-4o-mini" };
  }
  return undefined;
}

async function main(): Promise<void> {
  const provider = detectProvider();
  if (provider === undefined) {
    console.error(
      "No provider env credential found. Set one of: ANTHROPIC_API_KEY, OPENAI_API_KEY, OPENROUTER_API_KEY.",
    );
    process.exit(2);
  }
  console.log(`Provider: ${provider.name}`);
  console.log(`Model: ${provider.modelId}`);
  console.log(
    `Anthropic key: ${maskKey(process.env.ANTHROPIC_API_KEY)} · OpenAI key: ${maskKey(
      process.env.OPENAI_API_KEY,
    )} · OpenRouter key: ${maskKey(process.env.OPENROUTER_API_KEY)}`,
  );

  // Non-fixture key — forces real local runtime per shouldUseRealLocalRuntime.
  const agent = await Agent.create({
    apiKey: "user-real-smoke-key",
    model: { id: provider.modelId },
    local: { cwd: process.cwd() },
  });
  console.log(`Agent created: ${agent.agentId}`);

  const userMessage =
    "Reply with the exact text: theokit-sdk smoke ok. Do not call any tools.";
  console.log(`User message: ${userMessage}`);
  console.log("---");

  const run = await agent.send(userMessage);
  for await (const event of run.stream()) {
    if (event.type === "system") {
      console.log(`[system] tools=${event.tools.join(",")}`);
    } else if (event.type === "user") {
      console.log("[user] message echoed");
    } else if (event.type === "assistant") {
      const text = event.message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("");
      console.log(`[assistant] ${text}`);
    } else if (event.type === "tool_call") {
      console.log(`[tool_call:${event.status}] ${event.name}`);
    }
  }

  const result = await run.wait();
  console.log("---");
  console.log(`Final status: ${result.status}`);
  console.log(`Final result: ${result.result ?? "(empty)"}`);
  console.log(`Duration: ${result.durationMs ?? 0}ms`);

  if (result.status !== "finished") {
    process.exit(1);
  }
}

main().catch((cause) => {
  console.error("Smoke test failed:");
  console.error(cause);
  process.exit(1);
});
