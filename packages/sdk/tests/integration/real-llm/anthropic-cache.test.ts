/**
 * T0.2 — Anthropic prompt caching scenario (real-LLM, scaffold).
 *
 * Env-gated by ANTHROPIC_API_KEY (native-only; no OpenRouter fallback because
 * the cache_control opt-in shape is provider-specific — see SEPA initial brief
 * § C). Validates back-to-back sends complete. T3.5 wires explicit
 * cache_control emit + asserts cache_read_input_tokens > 0 on the second send.
 */

import { describe, expect, it } from "vitest";

import { Agent } from "../../../src/index.js";
import { useTempCwd } from "../../helpers/temp-workspace.js";
import { resolveRealLlmEnv } from "./_helpers/real-llm-env.js";

// Agent.create defaults its workspace to process.cwd(), which during a test run is the
// package itself — this file created agents without saying where, and the state landed in
// packages/sdk/.theokit/. See useTempCwd's docblock for the 540 MB that bought.
useTempCwd();

const env = resolveRealLlmEnv("anthropic", { nativeOnly: true });
const LONG_SYSTEM = `You are a helpful assistant. ${"This sentence pads the system prompt to exceed Anthropic's 1024-token cache threshold. ".repeat(80)}`;

describe.skipIf(env.shouldSkip)(`real-llm: anthropic cache (${env.provider})`, () => {
  it("processes two sends with a >1024-token system prompt (native cache path)", async () => {
    const agent = await Agent.create({
      apiKey: env.apiKey,
      model: { id: env.model },
      systemPrompt: LONG_SYSTEM,
    });
    try {
      const r1 = await (await agent.send("Reply 'first'.")).wait();
      const r2 = await (await agent.send("Reply 'second'.")).wait();
      expect(r1.status).toBe("finished");
      expect(r2.status).toBe("finished");
    } finally {
      await agent.dispose();
    }
  }, 120_000);
});
