import { describe, expect, it } from "vitest";
import { TheoKitContainer } from "../../src/theokit-container.js";

describe("E2E: container multi-agent", () => {
  it("registers multiple agents and retrieves each", () => {
    const container = new TheoKitContainer({
      agents: {
        classifier: { model: "openai/gpt-4o-mini", systemPrompt: "classify" },
        summarizer: { model: "anthropic/claude-3-haiku", systemPrompt: "summarize" },
        translator: { model: "openai/gpt-4o", systemPrompt: "translate" },
      },
    });
    expect(container.listAgents()).toEqual(["classifier", "summarizer", "translator"]);
    expect(container.agent("classifier").model).toEqual("openai/gpt-4o-mini");
    expect(container.agent("summarizer").model).toEqual("anthropic/claude-3-haiku");
  });
});
