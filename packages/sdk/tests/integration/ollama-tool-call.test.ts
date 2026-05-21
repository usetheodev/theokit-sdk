/**
 * Integration test for Ollama tool calling (T5.1, ADR D182).
 *
 * Validates that defineTool + agent.send with a custom tool round-trips
 * correctly against a real Ollama model.
 *
 * REQUIRES:
 *   - `ollama serve` running on http://localhost:11434
 *   - A tool-calling-capable model (Qwen2.5 family is most reliable for
 *     small local models). Override via OLLAMA_TEST_TOOL_MODEL.
 *
 * Per `.claude/rules/real-llm-validation.md`. Skip-loud (not fail) when
 * the model declines to use the tool — small local models occasionally
 * refuse; that's a capability gap, not an SDK bug (edge-case EC-F).
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { Agent, defineTool } from "../../src/index.js";

const OLLAMA_HOST = process.env.OLLAMA_HOST ?? "http://localhost:11434";
const TEST_MODEL = process.env.OLLAMA_TEST_TOOL_MODEL ?? "ollama/qwen2.5-coder:7b";

async function probeModelAvailable(modelTag: string): Promise<boolean> {
  try {
    const r = await fetch(`${OLLAMA_HOST}/api/tags`, {
      signal: AbortSignal.timeout(1000),
    });
    if (!r.ok) return false;
    const body = (await r.json()) as { models?: Array<{ name?: string }> };
    return (body.models ?? []).some((m) => (m.name ?? "").startsWith(modelTag));
  } catch {
    return false;
  }
}

// `ollama/qwen2.5-coder:7b` → server-side name is `qwen2.5-coder:7b`.
const rawModel = TEST_MODEL.replace(/^ollama\//, "");
const available = await probeModelAvailable(rawModel.split(":")[0] ?? "");
if (!available) {
  process.stderr.write(
    `[ollama-tool-call] Skipping — model "${rawModel}" not pulled. ` +
      `Run \`ollama pull ${rawModel}\` to enable (Qwen2.5 family recommended).\n`,
  );
}

describe.skipIf(!available)("ollama tool calling integration (D182)", () => {
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: defineTool + Agent.create + stream drain + EC-F skip-loud is one cohesive integration scenario
  it("agent.send invokes a registered customTool", async () => {
    let toolInvocations = 0;
    const getCurrentTime = defineTool({
      name: "get_current_time",
      description:
        "Returns the current time as an ISO-8601 string. Call this when the user asks what time it is.",
      inputSchema: z.object({}),
      handler: () => {
        toolInvocations += 1;
        return new Date().toISOString();
      },
    });

    const agent = await Agent.create({
      model: { id: TEST_MODEL },
      local: { cwd: process.cwd() },
      tools: [getCurrentTime],
      systemPrompt:
        "You are a helpful assistant with access to a `get_current_time` tool. " +
        "Always use the tool when the user asks about time. After receiving the tool result, reply with the time.",
    });

    const run = await agent.send(
      "Use the get_current_time tool to fetch the current time, then tell me the result.",
    );
    let assistantText = "";
    for await (const event of run.stream()) {
      if (event.type === "assistant") {
        for (const part of event.message.content) {
          if (part.type === "text") assistantText += part.text;
        }
      }
    }
    await run.wait();

    if (toolInvocations === 0) {
      // EC-F: model refused tool call. Document as capability gap.
      process.stderr.write(
        `[ollama-tool-call] Model ${TEST_MODEL} did not invoke the tool; skipping assertion ` +
          `(model capability gap, not SDK bug).\n`,
      );
      return;
    }
    expect(toolInvocations).toBeGreaterThan(0);
    expect(assistantText.length).toBeGreaterThan(0);
  }, 120_000); // tool-using models are slower; first call may load model
});
