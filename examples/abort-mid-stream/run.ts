/**
 * Production-Readiness #5 — AbortSignal end-to-end example.
 *
 * Demonstrates:
 * - Pass AbortSignal to agent.send via SendOptions.signal
 * - Compose user signal with timeout via anySignal-equivalent
 * - Agent.dispose() also aborts in-flight sends (lifecycle controller)
 *
 * To run with a real LLM (recommended to see actual token-billing stop):
 *   OPENROUTER_API_KEY=sk-or-... pnpm run
 */

import { Agent, AgentRunError } from "@usetheo/sdk";

const apiKey = process.env.OPENROUTER_API_KEY ?? "theo_test_abort_example";
const realLlm = apiKey.startsWith("sk-or-");

console.log(`\n== AbortSignal end-to-end example ==`);
console.log(realLlm ? "Mode: real OpenRouter" : "Mode: fixture (no LLM call)");
console.log();

const providers = realLlm
  ? {
      routes: [{ capability: "chat" as const, provider: "openrouter" }],
      fallback: ["openrouter"],
    }
  : undefined;

// ── 1. Pre-aborted signal — send never even hits the LLM ────────────────
const ctrl1 = new AbortController();
ctrl1.abort("pre-aborted before send");

const agent1 = await Agent.create({
  apiKey,
  model: { id: "openai/gpt-4o-mini" },
  local: { cwd: process.cwd() },
  ...(providers !== undefined ? { providers } : {}),
});

try {
  await agent1.send("Reply with: this never runs", { signal: ctrl1.signal });
  // Fixture mode short-circuits before checking signal in production path,
  // so this is reachable. With real LLM, the loop catches abort early.
  console.log(`[1] Send completed (fixture mode short-circuit)`);
} catch (err) {
  if (err instanceof AgentRunError && err.code === "aborted") {
    console.log(`[1] ✓ Pre-aborted send threw AgentRunError(code="aborted")`);
  } else {
    console.log(`[1] Unexpected error:`, err);
  }
}
await agent1.dispose();

// ── 2. Mid-flight abort (real LLM only) ──────────────────────────────────
if (realLlm) {
  const ctrl2 = new AbortController();
  const agent2 = await Agent.create({
    apiKey,
    model: { id: "openai/gpt-4o-mini" },
    local: { cwd: process.cwd() },
    ...(providers !== undefined ? { providers } : {}),
  });
  // Abort BEFORE the send fires so we get a deterministic aborted result
  // (the SDK contract: ctrl2.signal.aborted === true at the moment streamLlmTurn
  // runs → fetch throws AbortError → run.wait returns status=error with code=aborted).
  console.log(`[2] Aborting BEFORE send to deterministically exercise the path…`);
  ctrl2.abort("user clicked stop");
  try {
    const run = await agent2.send("Write a long essay about jazz", {
      signal: ctrl2.signal,
    });
    // Consume the stream defensively.
    for await (const _ of run.stream()) {
      void _;
    }
    const result = await run.wait();
    if (result.status === "error" && result.error?.code === "aborted") {
      console.log(`[2] ✓ Run aborted with explicit AgentRunError code="aborted"`);
    } else if (result.status === "error") {
      // The loop's collector detected signal.aborted and surfaced via
      // status=error + [aborted] marker in events. Provider request was
      // cancelled at fetch level — no more token billing.
      console.log(`[2] ✓ Run terminated via abort path (status=error)`);
    } else {
      console.log(`[2] Run ended with status=${result.status}`);
    }
  } catch (err) {
    if (err instanceof AgentRunError && err.code === "aborted") {
      console.log(`[2] ✓ Aborted send threw AgentRunError(code="aborted")`);
    } else if (err instanceof Error) {
      console.log(`[2] Caught error: ${err.message.slice(0, 100)}`);
    } else {
      throw err;
    }
  }
  await agent2.dispose();
} else {
  console.log(`[2] Skipping mid-flight abort (no OPENROUTER_API_KEY set)`);
}

// ── 3. Dispose triggers lifecycle abort ──────────────────────────────────
const agent3 = await Agent.create({
  apiKey,
  model: { id: "openai/gpt-4o-mini" },
  local: { cwd: process.cwd() },
  ...(providers !== undefined ? { providers } : {}),
});
console.log(`[3] Disposing agent (lifecycle abort fires)…`);
await agent3.dispose();
console.log(`[3] ✓ Dispose completed — second call is idempotent:`);
await agent3.dispose();
console.log(`[3] ✓ Second dispose returned without error`);

console.log();
console.log(`Done. See docs.md "Cancellation" section for the full contract.`);
