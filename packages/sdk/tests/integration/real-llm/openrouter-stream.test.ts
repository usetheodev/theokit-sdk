/**
 * T0.2 — OpenRouter streaming scenario (real-LLM).
 *
 * Env-gated by OPENROUTER_API_KEY. Validates streamed completion via
 * OpenRouter's SSE wire (OpenAI-compatible). Required for T3.1 parser
 * validation + T6.2 load test.
 */

import { describe, expect, it } from "vitest";

import { Agent } from "../../../src/index.js";
import { useTempCwd } from "../../helpers/temp-workspace.js";
import { resolveRealLlmEnv } from "./_helpers/real-llm-env.js";

// Agent.create defaults its workspace to process.cwd(), which during a test run is the
// package itself — this file created agents without saying where, and the state landed in
// packages/sdk/.theokit/. See useTempCwd's docblock for the 540 MB that bought.
useTempCwd();

const env = resolveRealLlmEnv("openrouter");

describe.skipIf(env.shouldSkip)(`real-llm: openrouter stream (${env.provider})`, () => {
  it("streams an assistant turn end-to-end via OpenRouter", async () => {
    const agent = await Agent.create({
      apiKey: env.apiKey,
      model: { id: env.model },
    });
    try {
      const run = await agent.send("Respond with a single word.");
      let events = 0;
      for await (const _event of run.stream()) {
        events += 1;
        if (events >= 1) break;
      }
      expect(events).toBeGreaterThanOrEqual(1);
      const result = await run.wait();
      expect(["finished", "running"]).toContain(result.status);
    } finally {
      await agent.dispose();
    }
  }, 60_000);
});
