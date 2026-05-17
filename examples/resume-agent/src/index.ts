import { Agent } from "@usetheo/sdk";

/**
 * Agent.resume(agentId) reattaches to an existing in-process agent. The
 * resumed handle shares the same registry entry, the same workspace, and
 * the same session-message history — so a follow-up question lands with
 * the conversation context the first send established.
 *
 * v1 limitation: the agent registry is in-memory (`internal/runtime/
 * agent-registry.ts`). After `process.exit`, the registry is gone — calling
 * `Agent.resume(agentId)` in a fresh process returns a placeholder handle
 * with empty session history. Cross-process resume needs a persistent
 * registry (future work).
 */

function pickModel(): string {
  if (process.env.ANTHROPIC_API_KEY) return "claude-sonnet-4-5-20250929";
  if (process.env.OPENAI_API_KEY) return "gpt-4o-mini";
  if (process.env.OPENROUTER_API_KEY) return "openai/gpt-4o-mini";
  throw new Error("Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or OPENROUTER_API_KEY in .env.");
}

async function main(): Promise<void> {
  const baseOptions = {
    apiKey: process.env.THEOKIT_API_KEY ?? "user-real-example-key",
    model: { id: pickModel() },
    local: { cwd: process.cwd() },
    systemPrompt:
      "You are a helpful assistant. Pay attention to the user's stated preferences in the conversation.",
  };

  // Step 1: create the agent and tell it something memorable about the user.
  const original = await Agent.create(baseOptions);
  const agentId = original.agentId;
  console.log(`Created agent: ${agentId}`);
  const r1 = await (await original.send("My favourite test runner is Vitest.")).wait();
  console.log(`[create-handle] said: ${r1.result}`);
  original.close();

  // Step 2: resume — fresh handle, same id, same session history.
  const resumed = await Agent.resume(agentId);
  console.log(`\nResumed handle agentId: ${resumed.agentId} (same as before: ${resumed.agentId === agentId})`);
  const r2 = await (await resumed.send("What's my favourite test runner?")).wait();
  console.log(`[resumed-handle] said: ${r2.result}`);
  await resumed.dispose();

  // Step 3 (DX helper): Agent.getOrCreate(id, options) collapses the
  // try/catch + UnknownAgentError + cold-create dance into a single call.
  // Idempotent: subsequent calls with the same id always resume.
  const helperHandle = await Agent.getOrCreate(agentId, baseOptions);
  console.log(
    `\n[getOrCreate-handle] agentId: ${helperHandle.agentId} (same id: ${helperHandle.agentId === agentId})`,
  );
  await helperHandle.dispose();
}

main().catch((cause) => {
  console.error("resume-agent failed:", cause);
  process.exit(1);
});
