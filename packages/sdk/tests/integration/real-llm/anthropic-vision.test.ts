/**
 * T0.2 — Anthropic vision scenario (real-LLM, scaffold).
 *
 * Env-gated. Mirror of openai-vision routed via Anthropic native (or
 * OpenRouter fallback). Validates the cross-provider vision content-parts
 * surface ahead of T3.10.
 */

import { describe, expect, it } from "vitest";

import { Agent } from "../../../src/index.js";
import { resolveRealLlmEnv } from "./_helpers/real-llm-env.js";

const env = resolveRealLlmEnv("anthropic");
const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

describe.skipIf(env.shouldSkip)(`real-llm: anthropic vision (${env.provider})`, () => {
  it("accepts a vision content message and returns a text answer", async () => {
    const agent = await Agent.create({
      apiKey: env.apiKey,
      model: { id: env.model },
    });
    try {
      const run = await agent.send({
        text: "What can you tell me about this image?",
        content: [
          { type: "text", text: "What can you tell me about this image?" },
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
