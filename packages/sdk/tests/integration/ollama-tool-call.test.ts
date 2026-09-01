/**
 * Integration test for Ollama tool calling (T5.1, ADR D182).
 *
 * Validates that Tool + agent.send with a custom tool round-trips
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

import { Agent, Tool } from "../../src/index.js";
import { useTempCwd } from "../helpers/temp-workspace.js";
import { OLLAMA_HOST, probeOllamaModel, serverModelName } from "./ollama-probe.js";

// This file passed `cwd: process.cwd()`, which during a test run is the package itself, so
// every agent it created persisted a real session into packages/sdk/.theokit/. The helper
// makes process.cwd() report a throwaway directory for this file only.
useTempCwd();

const TEST_MODEL = process.env.OLLAMA_TEST_TOOL_MODEL ?? "ollama/qwen2.5-coder:7b";

// `ollama/qwen2.5-coder:7b` → server-side name is `qwen2.5-coder:7b`.
const rawModel = serverModelName(TEST_MODEL);
const available =
  process.env.SKIP_OLLAMA_E2E !== "1" &&
  (await probeOllamaModel(rawModel.split(":")[0] ?? "", OLLAMA_HOST));
if (!available) {
  process.stderr.write(
    `[ollama-tool-call] Skipping — model "${rawModel}" not pulled. ` +
      `Run \`ollama pull ${rawModel}\` to enable (Qwen2.5 family recommended).\n`,
  );
}

describe.skipIf(!available)("ollama tool calling integration (D182)", () => {
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Tool + Agent.create + stream drain + EC-F skip-loud is one cohesive integration scenario
  it("agent.send invokes a registered customTool", async (ctx) => {
    let toolInvocations = 0;
    const getCurrentTime = Tool.create({
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
      apiKey: "local",
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
      // EC-F: the model declined the tool call — a capability gap, not an SDK bug. That judgement is
      // right and `return` was the wrong way to say it: a bare return leaves the two assertions below
      // unrun and reports PASS, so a model that cannot do this looks identical to one that did.
      // B-126 settled the mechanism for exactly this (sqlite-open.test.ts, lance-index.golden.test.ts).
      ctx.skip(`model ${TEST_MODEL} declined the tool call (capability gap, not an SDK bug)`);
      return;
    }
    expect(toolInvocations).toBeGreaterThan(0);
    expect(assistantText.length).toBeGreaterThan(0);
  }, 120_000); // tool-using models are slower; first call may load model
});
