/**
 * T0.2 — Anthropic streaming scenario (real-LLM).
 *
 * Env-gated. Mirrors openai-stream but routed via Anthropic (or OpenRouter
 * fallback). Used by T3.1 SSE parser correctness validation in T6.2.
 */

import { describe, expect, it } from "vitest";

import { Agent } from "../../../src/index.js";
import { useTempCwd } from "../../helpers/temp-workspace.js";
import { resolveRealLlmEnv } from "./_helpers/real-llm-env.js";

// Agent.create defaults its workspace to process.cwd(), which during a test run is the
// package itself — this file created agents without saying where, and the state landed in
// packages/sdk/.theokit/. See useTempCwd's docblock for the 540 MB that bought.
useTempCwd();

const env = resolveRealLlmEnv("anthropic");

describe.skipIf(env.shouldSkip)(`real-llm: anthropic stream (${env.provider})`, () => {
  it("streams a final answer end-to-end without errors", async () => {
    const agent = await Agent.create({
      apiKey: env.apiKey,
      model: { id: env.model },
    });
    try {
      const run = await agent.send("Write one short sentence about caching.");
      let events = 0;
      for await (const event of run.stream()) {
        events += 1;
        if (event.type === "assistant") break;
      }
      expect(events).toBeGreaterThanOrEqual(1);
      const result = await run.wait();
      expect(result.status).toBe("finished");
    } finally {
      await agent.dispose();
    }
  }, 60_000);
});
