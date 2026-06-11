import { describe, expect, it } from "vitest";

describe("E2E: agent lifecycle", () => {
  it("Agent.create exists and is callable", async () => {
    const { Agent } = await import("../../src/agent.js");
    expect(typeof Agent.create).toEqual("function");
    expect(typeof Agent.prompt).toEqual("function");
    expect(typeof Agent.builder).toEqual("function");
  });

  it("Agent.builder returns a builder with fluent API", async () => {
    const { Agent } = await import("../../src/agent.js");
    const builder = Agent.builder();
    expect(typeof builder.model).toEqual("function");
    expect(typeof builder.systemPrompt).toEqual("function");
    expect(typeof builder.tools).toEqual("function");
  });
});
