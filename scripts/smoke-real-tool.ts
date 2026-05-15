#!/usr/bin/env tsx
/**
 * Real smoke test exercising the agent loop with a shell tool call.
 * Drops a tmp workspace with a known file, asks the model to read it,
 * and verifies the assistant response contains the file content.
 *
 * Usage:
 *   pnpm exec tsx --env-file=.env scripts/smoke-real-tool.ts
 */

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Agent } from "../packages/sdk/src/index.js";

function detectModelId(): string {
  if (process.env.ANTHROPIC_API_KEY) return "claude-sonnet-4-5-20250929";
  if (process.env.OPENAI_API_KEY) return "gpt-4o-mini";
  if (process.env.OPENROUTER_API_KEY) return "openai/gpt-4o-mini";
  return "gpt-4o-mini";
}

async function main(): Promise<void> {
  const cwd = await mkdtemp(join(tmpdir(), "theokit-smoke-tool-"));
  await writeFile(join(cwd, "secret.txt"), "answer-is-42\n");
  console.log(`Workspace: ${cwd}`);

  const agent = await Agent.create({
    apiKey: "user-real-smoke-key",
    model: { id: detectModelId() },
    local: { cwd },
  });
  console.log(`Agent created: ${agent.agentId}`);

  const run = await agent.send(
    "Use the shell tool to run `cat secret.txt` in the workspace, then tell me what the file contains.",
  );

  for await (const event of run.stream()) {
    if (event.type === "tool_call" && event.status === "running") {
      const cmd =
        typeof event.args.command === "string" ? event.args.command : JSON.stringify(event.args);
      console.log(`[tool_call:running] ${event.name} → ${cmd}`);
    } else if (event.type === "tool_call" && event.status === "completed") {
      const stdout = (event.result as { stdout?: string } | undefined)?.stdout ?? "";
      console.log(`[tool_call:completed] ${event.name} stdout="${stdout.trim()}"`);
    } else if (event.type === "assistant") {
      const text = event.message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("");
      console.log(`[assistant] ${text}`);
    }
  }

  const result = await run.wait();
  console.log("---");
  console.log(`Final status: ${result.status}`);
  console.log(`Final result: ${result.result ?? "(empty)"}`);
  const containsAnswer = (result.result ?? "").includes("answer-is-42");
  console.log(`Result contains "answer-is-42": ${containsAnswer}`);
  process.exit(containsAnswer ? 0 : 1);
}

main().catch((cause) => {
  console.error("Smoke test failed:");
  console.error(cause);
  process.exit(1);
});
