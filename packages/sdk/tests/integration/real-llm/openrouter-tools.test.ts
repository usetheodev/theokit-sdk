/**
 * T0.2 — OpenRouter tools scenario (real-LLM).
 *
 * Env-gated by OPENROUTER_API_KEY. Validates tool-use loop via OpenRouter's
 * canonical OpenAI-compatible surface; pairs with openai-tools for routing
 * parity verification.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { Agent, Tool } from "../../../src/index.js";
import { useTempCwd } from "../../helpers/temp-workspace.js";
import { resolveRealLlmEnv } from "./_helpers/real-llm-env.js";

// Agent.create defaults its workspace to process.cwd(), which during a test run is the
// package itself — this file created agents without saying where, and the state landed in
// packages/sdk/.theokit/. See useTempCwd's docblock for the 540 MB that bought.
useTempCwd();

const env = resolveRealLlmEnv("openrouter");

describe.skipIf(env.shouldSkip)(`real-llm: openrouter tools (${env.provider})`, () => {
  it("invokes a tool and returns a final answer routed via OpenRouter", async () => {
    let invocations = 0;
    const echoTool = Tool.create({
      name: "echo_back",
      description: "Echo a phrase the caller provides back.",
      inputSchema: z.object({ phrase: z.string() }),
      handler: ({ phrase }: { phrase: string }) => {
        invocations += 1;
        return JSON.stringify({ echoed: phrase });
      },
    });
    const agent = await Agent.create({
      apiKey: env.apiKey,
      model: { id: env.model },
      tools: [echoTool],
      systemPrompt:
        "You have an echo_back tool. When asked to echo anything, call the tool with the phrase.",
    });
    try {
      const run = await agent.send('Echo back the phrase "sky-blue-42" using the tool.');
      const result = await run.wait();
      expect(result.status).toBe("finished");
      expect(invocations).toBeGreaterThanOrEqual(1);
      expect(result.result).toBeTruthy();
    } finally {
      await agent.dispose();
    }
  }, 60_000);
});
