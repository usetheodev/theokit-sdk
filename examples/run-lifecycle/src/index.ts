import { Agent } from "@usetheo/sdk";

/**
 * Run lifecycle inspection. After `agent.send()` returns a `Run`,
 * the handle exposes:
 *   - `run.supports(op)` / `run.unsupportedReason(op)`
 *   - `run.onDidChangeStatus(listener)`
 *   - `run.cancel()`
 *   - `run.conversation()` — structured per-turn view
 *
 * This example wires `onDidChangeStatus`, prints the supported
 * operations, and dumps the conversation turns after completion.
 */

function pickModel(): string {
  if (process.env.ANTHROPIC_API_KEY) return "claude-sonnet-4-5-20250929";
  if (process.env.OPENAI_API_KEY) return "gpt-4o-mini";
  if (process.env.OPENROUTER_API_KEY) return "openai/gpt-4o-mini";
  throw new Error("Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or OPENROUTER_API_KEY in .env.");
}

async function main(): Promise<void> {
  const agent = await Agent.create({
    apiKey: process.env.THEOKIT_API_KEY ?? "user-real-example-key",
    model: { id: pickModel() },
    local: { cwd: process.cwd() },
    systemPrompt: "Reply concisely.",
  });
  const run = await agent.send("List three primary colors, comma-separated.");

  console.log(`run ${run.id}`);
  console.log(`  supports(stream)   = ${run.supports("stream")}`);
  console.log(`  supports(cancel)   = ${run.supports("cancel")}`);
  console.log(`  supports(downloadArtifact) = ${run.supports("downloadArtifact")}`);
  console.log(`  unsupportedReason(downloadArtifact) = ${run.unsupportedReason("downloadArtifact") ?? "(supported)"}`);

  const statuses: string[] = [];
  const unsubscribe = run.onDidChangeStatus((status) => {
    statuses.push(status);
  });

  const result = await run.wait();
  unsubscribe();
  console.log(`\nstatus transitions: ${statuses.join(" → ")}`);
  console.log(`final result: ${result.result}`);

  const conversation = await run.conversation();
  console.log(`\nconversation turns: ${conversation.length}`);
  for (const [i, turn] of conversation.entries()) {
    console.log(`  [${i}] type=${turn.type}`);
  }
}

main().catch((cause) => {
  console.error("run-lifecycle failed:", cause);
  process.exit(1);
});
