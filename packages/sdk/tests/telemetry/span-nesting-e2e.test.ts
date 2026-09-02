/**
 * M3 #64 (T1.1) — RED-first END-TO-END: the PRODUCTION threading (ctx.sendSpan →
 * llm.call in loop-llm-stream, parentSpan → tool.call in tool-dispatch) must nest
 * child spans under agent.send. Deleting any threading line fails this test.
 * Drives the real runAgentLoop with a real telemetry handle + the OTel collector.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runAgentLoop } from "../../src/internal/agent-loop/loop.js";
import type { AgentLoopInputs } from "../../src/internal/agent-loop/types.js";
import type {
  LlmClient,
  LlmEvent,
  LlmFinish,
  LlmToolCallPart,
} from "../../src/internal/llm/types.js";
import { HooksExecutor } from "../../src/internal/runtime/hooks/hooks-executor.js";
import { createTelemetry } from "../../src/internal/telemetry/tracer.js";
import {
  findSpanEventually,
  findSpanOrThrow,
  installOtelTestCollector,
  uninstallOtelTestCollector,
} from "./helpers/otel-test-collector.js";

/** LLM: emit one tool_use on the first turn, then end. */
function toolThenEndLlm(): LlmClient {
  let turn = 0;
  return {
    name: "mock",
    async *stream(): AsyncGenerator<LlmEvent, LlmFinish, void> {
      yield { type: "text_delta", text: "" };
      turn += 1;
      if (turn === 1) {
        const call: LlmToolCallPart = { type: "tool_use", id: "c1", name: "probe", input: {} };
        return {
          stopReason: "tool_use",
          text: "",
          toolCalls: [call],
          inputTokens: 1,
          outputTokens: 1,
        };
      }
      return {
        stopReason: "end_turn",
        text: "done",
        toolCalls: [],
        inputTokens: 1,
        outputTokens: 1,
      };
    },
  };
}

describe("M3 #64 — span nesting end-to-end (production threading)", () => {
  beforeEach(() => installOtelTestCollector());
  afterEach(async () => await uninstallOtelTestCollector());

  it("llm.call AND tool.call nest under agent.send through the real loop", async () => {
    const telemetry = createTelemetry({ enabled: true });
    const inputs: AgentLoopInputs = {
      agentId: "nest-e2e",
      runId: "run-1",
      userMessage: "go",
      model: { id: "mock" },
      llm: toolThenEndLlm(),
      mcp: new Map(),
      hooks: new HooksExecutor(process.cwd()),
      shellCwd: process.cwd(),
      shellSandbox: false,
      maxIterations: 4,
      telemetry,
      customTools: [
        {
          name: "probe",
          description: "probe",
          inputSchema: { type: "object" },
          handler: () => "ok",
        },
      ],
    };
    await runAgentLoop(inputs);
    // Poll (deterministic) for agent.send — it ends last, in the finally; once it is
    // present, llm.call/tool.call (ended earlier in the loop) are guaranteed present too.
    // Replaces a magic 30ms sleep that flaked under scheduling jitter.
    const send = await findSpanEventually("agent.send");
    const llm = findSpanOrThrow("llm.call");
    const tool = findSpanOrThrow("tool.call");
    // The production threading nests both children under the run span.
    expect(llm.parentSpanId).toBe(send.spanId);
    expect(tool.parentSpanId).toBe(send.spanId);
  });
});
