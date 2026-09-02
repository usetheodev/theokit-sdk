/**
 * T0.2 — OpenAI streaming scenario (real-LLM).
 *
 * Env-gated. Validates `Run.stream()` emits at least one assistant token-delta
 * event during a real LLM streaming session. Full SSE-spec correctness lands
 * in T3.1 + T6.2 (load test); this scaffold asserts the wire.
 */

import { describe, expect, it } from "vitest";

import { Agent } from "../../../src/index.js";
import { useTempCwd } from "../../helpers/temp-workspace.js";
import { resolveRealLlmEnv } from "./_helpers/real-llm-env.js";

// Agent.create defaults its workspace to process.cwd(), which during a test run is the
// package itself — this file created agents without saying where, and the state landed in
// packages/sdk/.theokit/. See useTempCwd's docblock for the 540 MB that bought.
useTempCwd();

const env = resolveRealLlmEnv("openai");

describe.skipIf(env.shouldSkip)(`real-llm: openai stream (${env.provider})`, () => {
  it("emits at least one streamed assistant event before run.wait() resolves", async () => {
    const agent = await Agent.create({
      apiKey: env.apiKey,
      model: { id: env.model },
    });
    try {
      const run = await agent.send("Reply with a haiku about typescript.");
      let assistantEvents = 0;
      for await (const event of run.stream()) {
        if (event.type === "assistant") assistantEvents += 1;
        if (assistantEvents >= 1) break;
      }
      expect(assistantEvents).toBeGreaterThanOrEqual(1);
      const result = await run.wait();
      // `wait()` resolves when the run reaches a terminal state, so "running" is the one status this
      // cannot be. Accepting it made the assertion unfalsifiable: a wait() that returned early — the
      // failure worth catching here — passed.
      expect(result.status).toBe("finished");
    } finally {
      await agent.dispose();
    }
  }, 60_000);
});
