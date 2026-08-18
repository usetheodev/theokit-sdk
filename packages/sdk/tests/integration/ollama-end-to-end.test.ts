/**
 * Integration test for Ollama provider (T1.2, ADR D182).
 *
 * Per `.claude/rules/real-llm-validation.md`: features that touch `agent.send()`
 * require validation against a real LLM. This test proves D182 (Ollama builtin
 * provider) works end-to-end.
 *
 * REQUIRES:
 *   - `ollama serve` running on http://localhost:11434 (override with OLLAMA_HOST)
 *   - `ollama pull llama3.2:3b` (or set OLLAMA_TEST_MODEL to override)
 *
 * Without Ollama running, the entire describe block skips silently (zero false-fail).
 * CI runners without Ollama installed → skipped. Developer with `ollama serve`
 * → executes and validates.
 */

import { describe, expect, it } from "vitest";

import { Agent } from "../../src/index.js";
import { OLLAMA_HOST, probeOllamaModel, serverModelName } from "./_ollama-probe.js";

const TEST_MODEL = process.env.OLLAMA_TEST_MODEL ?? "ollama/llama3.2:3b";
const RAW_MODEL = serverModelName(TEST_MODEL);

// Top-level await: evaluated BEFORE `describe.skipIf` so the condition is
// known at describe-time. Without this, vitest skips the suite even when
// Ollama is up (because beforeAll runs AFTER describe registration).
// `SKIP_OLLAMA_E2E=1` lets CI/loaded-machine runs skip the suite even
// when ollama is up but too slow to respond within the test timeout.
const ollamaAvailable =
  process.env.SKIP_OLLAMA_E2E !== "1" && (await probeOllamaModel(RAW_MODEL, OLLAMA_HOST));
if (!ollamaAvailable) {
  // B-096 — this used to probe only that the server ANSWERED. With Ollama up and a different
  // model pulled, the suite ran against a model the server does not have and both tests failed
  // on empty content instead of skipping. The two sibling suites already probed for the model;
  // this one now shares their probe, so the three agree.
  process.stderr.write(
    `[ollama-end-to-end] Skipping — Ollama not reachable at ${OLLAMA_HOST}, ` +
      `or model "${RAW_MODEL}" not pulled. ` +
      `Run \`ollama serve\` and \`ollama pull ${RAW_MODEL}\` to enable this test.\n`,
  );
}

// dogfood-regressions-fix-plan v1.1 T3.1 + addendum — drains an Ollama
// send; under full-suite contention, the first cold-warmup request can
// legitimately return empty text from the model side (Ollama-side flake,
// NOT an SDK bug). We tolerate one empty-content retry before failing —
// the load-bearing assertion "real LLM produced non-empty content" still
// holds, with an honest stderr warn so the model-side flake is visible.
async function drainAgentSend(prompt: string): Promise<string> {
  const agent = await Agent.create({
    apiKey: "local",
    model: { id: TEST_MODEL },
    local: { cwd: process.cwd() },
  });
  const run = await agent.send(prompt);
  let text = "";
  for await (const event of run.stream()) {
    if (event.type === "assistant") {
      for (const part of event.message.content) {
        if (part.type === "text") text += part.text;
      }
    }
  }
  await run.wait();
  return text;
}

describe.skipIf(!ollamaAvailable)("ollama integration (D182)", () => {
  it("agent.send returns assistant message with non-empty content", async () => {
    let assistantText = await drainAgentSend("Reply with one short greeting.");
    if (assistantText.length === 0) {
      // Model-side cold-warmup empty-response flake. Retry once with a
      // simpler prompt; if still empty, fail honestly so the test
      // surfaces a real regression rather than masking it.
      process.stderr.write(
        "[ollama-end-to-end] Empty content on first call (Ollama cold-warmup flake). Retrying once with simpler prompt.\n",
      );
      assistantText = await drainAgentSend("Say hi.");
    }
    expect(assistantText.length).toBeGreaterThan(0);
  }, 240_000); // EC-D: 120s base + 120s retry budget (worst case = two cold sends).

  it("onDelta callback receives text-delta updates", async () => {
    const deltas: string[] = [];
    const agent = await Agent.create({
      apiKey: "local",
      model: { id: TEST_MODEL },
      local: { cwd: process.cwd() },
    });

    const run = await agent.send("Reply with the word HELLO and nothing else.", {
      onDelta: (event) => {
        if (event.update.type === "text-delta") deltas.push(event.update.text);
      },
    });
    // Drain the stream to ensure onDelta callbacks fire.
    for await (const _event of run.stream()) {
      // intentionally empty — drain only
    }
    await run.wait();
    expect(deltas.length).toBeGreaterThan(0);
  }, 120_000);
});
