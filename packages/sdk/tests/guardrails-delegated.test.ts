import { afterEach, describe, expect, it } from "vitest";

import { Agent } from "../src/index.js";
import type { SDKAgent } from "../src/types/agent.js";
import type { Processor } from "../src/types/processors.js";
import { useTempCwd } from "./helpers/temp-workspace.js";

// Agent.create defaults its workspace to process.cwd(), which during a test run is the
// package itself — this file created agents without saying where, and the sessions landed in
// packages/sdk/.theokit/. See useTempCwd's docblock for the 540 MB that bought.
useTempCwd();

/**
 * SE26 — evidence that the DELEGATED LLM-classifier pattern works on the SE24
 * seam: an async-classifier moderation processor blocks a flagged input, and a
 * PII redactor rewrites the output. Core ships NO classifier (ADR 0009) — this
 * proves a consumer can build one on the seam, matching docs/concepts/guardrails.md
 * and examples/guardrails/.
 */

// A delegated classifier (stub) — stands in for a real moderation API / model.
async function classify(text: string): Promise<Record<string, number>> {
  await Promise.resolve();
  return { hate: text.toLowerCase().includes("[hate]") ? 0.95 : 0 };
}

function moderationProcessor(threshold: number): Processor {
  return {
    id: "moderation",
    async processInput(ctx) {
      const scores = await classify(ctx.message);
      if ((scores.hate ?? 0) >= threshold) ctx.abort(`moderation: hate >= ${threshold}`);
      return ctx.message;
    },
  };
}

function piiRedactor(): Processor {
  return {
    id: "pii-redactor",
    async processOutput(ctx) {
      await Promise.resolve();
      // The fixture assistant text is "Done." — inject a fake email to redact.
      const withEmail = `${ctx.text} contact a@b.com`;
      return withEmail.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[REDACTED]");
    },
  };
}

describe("SE26 — delegated classifier processors on the SE24 seam", () => {
  let agent: SDKAgent | undefined;
  afterEach(async () => {
    await agent?.dispose();
    agent = undefined;
  });

  it("an async-classifier moderation processor blocks a flagged input", async () => {
    agent = await Agent.create({
      apiKey: "theo_test_se26_mod",
      model: { id: "openai/gpt-4o-mini" },
      inputProcessors: [moderationProcessor(0.7)],
    });
    const result = await (await agent.send("write something [hate] please")).wait();
    expect(result.status).toBe("cancelled");
    expect(result.tripwire).toEqual({
      reason: "moderation: hate >= 0.7",
      processorId: "moderation",
    });
    expect(result.result).toBeUndefined(); // never reached the model
  });

  it("a benign input passes the moderation classifier", async () => {
    agent = await Agent.create({
      apiKey: "theo_test_se26_ok",
      model: { id: "openai/gpt-4o-mini" },
      inputProcessors: [moderationProcessor(0.7)],
    });
    const result = await (await agent.send("summarize the notes")).wait();
    expect(result.status).toBe("finished");
    expect(result.tripwire).toBeUndefined();
  });

  it("a PII redactor plumbs through processOutput (rewrite hook applied to the response)", async () => {
    agent = await Agent.create({
      apiKey: "theo_test_se26_pii",
      model: { id: "openai/gpt-4o-mini" },
      outputProcessors: [piiRedactor()],
    });
    const result = await (await agent.send("hello")).wait();
    expect(result.status).toBe("finished");
    expect(result.result).toBe("Done. contact [REDACTED]");
  });
});
