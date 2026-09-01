/**
 * M3 #64 (T1.3) + #66 (T3.1) — RED-first: the loop must EMIT tool/LLM durations +
 * token throughput as metrics (were measured but only span-attributes), and WARN +
 * count when a provider omits usage (silent budget undercount). Driven through the
 * real runAgentLoop with a mock LLM + a spy telemetry handle.
 */
import { describe, expect, it, vi } from "vitest";
import { runAgentLoop } from "../../../src/internal/agent-loop/loop.js";
import type { AgentLoopInputs } from "../../../src/internal/agent-loop/loop-types.js";
import type { LlmClient, LlmEvent, LlmFinish } from "../../../src/internal/llm/types.js";
import { HISTOGRAM_NAMES } from "../../../src/internal/telemetry/span-names.js";
import { makeLoopInputs } from "./_helpers/make-inputs.js";

function spyTelemetry(): {
  handle: NonNullable<AgentLoopInputs["telemetry"]>;
  metrics: string[];
} {
  const metrics: string[] = [];
  const noopSpan = {
    setAttribute: () => undefined,
    setAttributes: () => undefined,
    addEvent: () => undefined,
    setStatus: () => undefined,
    recordException: () => undefined,
    end: () => undefined,
    spanContext: () => ({ traceId: "0".repeat(32), spanId: "0".repeat(16) }),
    isRecording: () => false,
  };
  const handle = {
    enabled: true,
    includeContent: false,
    startSpan: () => noopSpan,
    startChildSpan: () => noopSpan,
    recordHistogram: (name: string) => {
      metrics.push(name);
    },
    endAll: () => undefined,
  } as unknown as NonNullable<AgentLoopInputs["telemetry"]>;
  return { handle, metrics };
}

function llmWith(finish: Partial<LlmFinish>): LlmClient {
  return {
    name: "mock",
    async *stream(): AsyncGenerator<LlmEvent, LlmFinish, void> {
      yield { type: "text_delta", text: "" };
      return {
        stopReason: "end_turn",
        text: "done",
        toolCalls: [],
        inputTokens: 1,
        outputTokens: 1,
        ...finish,
      };
    },
  };
}

const baseInputs = (llm: LlmClient, telemetry: AgentLoopInputs["telemetry"]): AgentLoopInputs =>
  makeLoopInputs({
    agentId: "metrics",
    userMessage: "go",
    model: { id: "mock" },
    llm,
    maxIterations: 4,
    telemetry,
  });

describe("M3 #64/#66 — metrics emitted through the loop", () => {
  it("emits llm.call duration + token metrics on a normal finish", async () => {
    const { handle, metrics } = spyTelemetry();
    await runAgentLoop(baseInputs(llmWith({}), handle));
    expect(metrics).toContain(HISTOGRAM_NAMES.LLM_CALL_DURATION_MS);
    expect(metrics).toContain(HISTOGRAM_NAMES.LLM_TOKENS);
    expect(metrics).not.toContain(HISTOGRAM_NAMES.LLM_USAGE_MISSING);
  });

  it("emits the usage-missing counter + WARN when the provider omits usage (#66)", async () => {
    const { handle, metrics } = spyTelemetry();
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    // A finish with NO token fields → the provider omitted usage.
    await runAgentLoop(
      baseInputs(llmWith({ inputTokens: undefined, outputTokens: undefined }), handle),
    );
    expect(metrics).toContain(HISTOGRAM_NAMES.LLM_USAGE_MISSING);
    expect(metrics).not.toContain(HISTOGRAM_NAMES.LLM_TOKENS);
    expect(stderr.mock.calls.map((c) => String(c[0])).join("")).toMatch(/usage missing/i);
    stderr.mockRestore();
  });
});
