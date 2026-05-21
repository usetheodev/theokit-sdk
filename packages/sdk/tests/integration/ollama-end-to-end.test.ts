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

const OLLAMA_HOST = process.env.OLLAMA_HOST ?? "http://localhost:11434";
const TEST_MODEL = process.env.OLLAMA_TEST_MODEL ?? "ollama/llama3.2:3b";

async function probeOllama(): Promise<boolean> {
  try {
    const r = await fetch(`${OLLAMA_HOST}/api/tags`, {
      signal: AbortSignal.timeout(500),
    });
    return r.ok;
  } catch {
    return false;
  }
}

// Top-level await: evaluated BEFORE `describe.skipIf` so the condition is
// known at describe-time. Without this, vitest skips the suite even when
// Ollama is up (because beforeAll runs AFTER describe registration).
const ollamaAvailable = await probeOllama();
if (!ollamaAvailable) {
  process.stderr.write(
    `[ollama-end-to-end] Skipping — Ollama not reachable at ${OLLAMA_HOST}. ` +
      "Run `ollama serve` to enable this test.\n",
  );
}

describe.skipIf(!ollamaAvailable)("ollama integration (D182)", () => {
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: end-to-end stream consume + assertion pipeline is intentionally inline for clarity in an integration test
  it("agent.send returns assistant message with non-empty content", async () => {
    const agent = await Agent.create({
      apiKey: "local",
      model: { id: TEST_MODEL },
      local: { cwd: process.cwd() },
    });

    const run = await agent.send("Reply with one short greeting.");

    // Collect text from stream — this is the load-bearing assertion for
    // D182: real Ollama-driven content arrived through the SDK pipeline.
    let assistantText = "";
    for await (const event of run.stream()) {
      if (event.type === "assistant") {
        for (const part of event.message.content) {
          if (part.type === "text") assistantText += part.text;
        }
      }
    }
    await run.wait();
    expect(assistantText.length).toBeGreaterThan(0);
  }, 60_000); // EC-D: first request can take 10-60s while Ollama warms up.

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
  }, 60_000);
});
