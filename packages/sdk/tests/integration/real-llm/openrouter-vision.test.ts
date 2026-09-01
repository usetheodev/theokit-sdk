/**
 * T0.2 — OpenRouter vision scenario (real-LLM, scaffold).
 *
 * Env-gated by OPENROUTER_API_KEY. Validates the vision wire is preserved
 * across OpenRouter's OpenAI-compatible vision routing. Required for T6.1
 * dimension coverage.
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
const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

describe.skipIf(env.shouldSkip)(`real-llm: openrouter vision (${env.provider})`, () => {
  it("accepts a vision content message routed via OpenRouter", async () => {
    const agent = await Agent.create({
      apiKey: env.apiKey,
      model: { id: env.model },
    });
    try {
      const run = await agent.send({
        text: "Briefly describe the image.",
        content: [
          { type: "text", text: "Briefly describe the image." },
          { type: "image", source: { type: "url", url: PNG_DATA_URL } },
        ],
      } as never);
      const result = await run.wait();
      expect(result.status).toBe("finished");
      expect((result.result ?? "").length).toBeGreaterThan(0);
    } finally {
      await agent.dispose();
    }
  }, 60_000);
});
