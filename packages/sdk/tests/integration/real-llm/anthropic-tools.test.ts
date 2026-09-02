/**
 * T0.2 — Anthropic tools scenario (real-LLM).
 *
 * Env-gated. Mirror of openai-tools but routed via Anthropic (or OpenRouter
 * fallback when ANTHROPIC_API_KEY absent). Validates the tool-use loop.
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

const env = resolveRealLlmEnv("anthropic");

describe.skipIf(env.shouldSkip)(`real-llm: anthropic tools (${env.provider})`, () => {
  it("invokes a tool and loops back to a final answer", async () => {
    let invocations = 0;
    const lookupCustomer = Tool.create({
      name: "lookup_customer",
      description: "Look up a customer record by id.",
      inputSchema: z.object({ id: z.string() }),
      handler: ({ id }: { id: string }) => {
        invocations += 1;
        return JSON.stringify({ id, status: "active", plan: "pro" });
      },
    });
    const agent = await Agent.create({
      apiKey: env.apiKey,
      model: { id: env.model },
      tools: [lookupCustomer],
      systemPrompt:
        "You have a lookup_customer tool. When the user mentions a customer id, call the tool.",
    });
    try {
      const run = await agent.send("What is the plan for customer cust-42?");
      const result = await run.wait();
      expect(result.status).toBe("finished");
      expect(invocations).toBeGreaterThanOrEqual(1);
      expect((result.result ?? "").toLowerCase()).toContain("pro");
    } finally {
      await agent.dispose();
    }
  }, 60_000);
});
