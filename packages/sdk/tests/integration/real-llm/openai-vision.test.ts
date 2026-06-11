/**
 * T0.2 — OpenAI vision scenario (real-LLM, scaffold).
 *
 * Env-gated. Validates that the SDK accepts an image-content user message
 * AND the LLM returns a coherent text answer. Full vision content-parts
 * matrix lands in T3.10 (DR3 vision parts LARGE batch).
 */

import { describe, expect, it } from "vitest";

import { Agent } from "../../../src/index.js";
import { resolveRealLlmEnv } from "./_helpers/real-llm-env.js";

const env = resolveRealLlmEnv("openai");
// 1×1 transparent PNG (smallest valid PNG payload)
const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

describe.skipIf(env.shouldSkip)(`real-llm: openai vision (${env.provider})`, () => {
  it("accepts a vision content message and returns a text answer", async () => {
    const agent = await Agent.create({
      apiKey: env.apiKey,
      model: { id: env.model },
    });
    try {
      const run = await agent.send({
        text: "Describe the image briefly.",
        content: [
          { type: "text", text: "Describe the image briefly." },
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
