import { describe, expect, it } from "vitest";
import { TheoKitContainer } from "../src/theokit-container.js";

describe("TheoKitContainer", () => {
  it("registers and retrieves agents by name", () => {
    const container = new TheoKitContainer({
      agents: { greeter: { model: "openai/gpt-4o-mini", systemPrompt: "greet" } },
    });
    const agent = container.agent("greeter");
    expect(agent).toBeDefined();
    expect(agent.model).toEqual("openai/gpt-4o-mini");
  });

  it("throws on unknown agent name", () => {
    const container = new TheoKitContainer({ agents: { a: { model: "x" } } });
    expect(() => container.agent("unknown")).toThrow('Agent "unknown" not registered');
  });

  it("registers and retrieves tools", () => {
    const tool = { name: "echo", handler: () => "hi" };
    const container = new TheoKitContainer({ tools: { echo: tool } });
    expect(container.tool("echo")).toEqual(tool);
  });

  it("throws on unknown tool name", () => {
    const container = new TheoKitContainer({});
    expect(() => container.tool("missing")).toThrow('Tool "missing" not registered');
  });

  it("registers and retrieves workflows", () => {
    const wf = { name: "pipeline" };
    const container = new TheoKitContainer({ workflows: { pipeline: wf } });
    expect(container.workflow("pipeline")).toEqual(wf);
  });

  it("lists registered agents", () => {
    const container = new TheoKitContainer({
      agents: { a: { model: "m1" }, b: { model: "m2" } },
    });
    expect(container.listAgents()).toEqual(["a", "b"]);
  });

  it("EC-7: run after dispose throws AgentDisposedError", async () => {
    const container = new TheoKitContainer({
      agents: { a: { model: "openai/gpt-4o-mini" } },
    });
    const agent = container.agent("a");
    agent.dispose();
    await expect(container.run("a", "hello")).rejects.toThrow("AgentDisposedError");
  });

  it("empty container has no agents/tools/workflows", () => {
    const container = new TheoKitContainer({});
    expect(container.listAgents()).toEqual([]);
    expect(container.listTools()).toEqual([]);
    expect(container.listWorkflows()).toEqual([]);
  });
});
