import { afterEach, describe, expect, it } from "vitest";

import {
  _resetReasoningWarnForTests,
  createThinkTool,
  isNativeReasoning,
  REASONING_PREAMBLE,
  reasoningActive,
} from "../src/internal/runtime/reasoning/native-reasoning.js";
import { SystemPromptPipeline } from "../src/internal/runtime/system-prompt/pipeline.js";
import { ReasoningPromptProvider } from "../src/internal/runtime/system-prompt/sources/reasoning-provider.js";
import type { SystemPromptAssemblyContext } from "../src/internal/runtime/system-prompt/types.js";

const baseCtx = { memory: [] } as unknown as SystemPromptAssemblyContext;

afterEach(() => _resetReasoningWarnForTests());

describe("SE37 — internal think tool (auto-attached by reasoning: true)", () => {
  it("is named think and echoes the thought (no-side-effect scratchpad)", async () => {
    const think = createThinkTool();
    expect(think.name).toBe("think");
    const out = await think.handler({ thought: "compare 9.11 and 9.9 by magnitude" });
    expect(out).toBe("compare 9.11 and 9.9 by magnitude");
  });

  it("rejects an empty thought (fail-loud at the handler boundary)", async () => {
    await expect(createThinkTool().handler({ thought: "" })).rejects.toThrow(/thought/i);
  });
});

describe("SE37 — double-reasoning guard", () => {
  it("a bare-string / no-param model is NOT native reasoning", () => {
    expect(isNativeReasoning("openai/gpt-4o-mini")).toBe(false);
    expect(isNativeReasoning(undefined)).toBe(false);
    expect(isNativeReasoning({ id: "openai/gpt-4o-mini" })).toBe(false);
  });

  it("a model with a thinking/reasoning param IS native reasoning", () => {
    expect(isNativeReasoning({ id: "x", params: [{ id: "thinking", value: "high" }] })).toBe(true);
    expect(
      isNativeReasoning({ id: "x", params: [{ id: "reasoning_effort", value: "high" }] }),
    ).toBe(true);
  });

  it("reasoningActive is true only when on AND the model is not native", () => {
    expect(reasoningActive(true, { id: "openai/gpt-4o-mini" })).toBe(true);
    expect(reasoningActive(false, { id: "openai/gpt-4o-mini" })).toBe(false);
    expect(reasoningActive(undefined, { id: "openai/gpt-4o-mini" })).toBe(false);
  });

  it("reasoningActive suppresses (returns false) when the model reasons natively", () => {
    expect(reasoningActive(true, { id: "x", params: [{ id: "thinking", value: "high" }] })).toBe(
      false,
    );
  });
});

describe("SE37 — reasoning preamble provider", () => {
  it("contributes the preamble when ctx.reasoning is true", async () => {
    const out = await new ReasoningPromptProvider().contribute({ ...baseCtx, reasoning: true });
    expect(out).toBe(REASONING_PREAMBLE);
  });

  it("contributes nothing when reasoning is off (byte-identical prompt)", async () => {
    const provider = new ReasoningPromptProvider();
    expect(await provider.contribute(baseCtx)).toBeUndefined();
    expect(await provider.contribute({ ...baseCtx, reasoning: false })).toBeUndefined();
  });

  it("is registered first in the default pipeline (preamble leads the prompt)", async () => {
    const pipeline = SystemPromptPipeline.default();
    expect(pipeline.providers[0]?.id).toBe("reasoning");
    const assembled = await pipeline.assemble({
      ...baseCtx,
      reasoning: true,
      baseSystemPrompt: "You are a bot.",
    });
    expect(assembled).toMatch(/^Think step by step/);
    expect(assembled).toContain("You are a bot.");
  });

  it("assembles byte-identically to baseline when reasoning is off", async () => {
    const pipeline = SystemPromptPipeline.default();
    const off = await pipeline.assemble({ ...baseCtx, baseSystemPrompt: "You are a bot." });
    expect(off).toBe("You are a bot.");
  });
});
