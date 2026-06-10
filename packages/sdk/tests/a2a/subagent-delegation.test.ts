import { describe, expect, it, vi } from "vitest";

import { defineSubAgent, MaxDelegationDepthError } from "../../src/a2a/subagent.js";

describe("defineSubAgent", () => {
  it("returns a CustomTool with name and description", () => {
    const tool = defineSubAgent({
      name: "researcher",
      description: "Researches a topic",
      instructions: "You are a researcher.",
    });
    expect(tool.name).toBe("researcher");
    expect(tool.description).toBe("Researches a topic");
    expect(tool.inputSchema).toBeDefined();
    expect(typeof tool.handler).toBe("function");
  });

  it("creates child agent and returns final text", async () => {
    const mockDispose = vi.fn();
    const mockSend = vi
      .fn()
      .mockResolvedValue({ wait: () => Promise.resolve({ result: "research result" }) });
    const mockCreate = vi.fn().mockResolvedValue({
      send: mockSend,
      dispose: mockDispose,
    });

    vi.doMock("../../src/agent.js", () => ({
      Agent: { create: mockCreate },
    }));

    const tool = defineSubAgent({
      name: "researcher",
      description: "Researches",
      instructions: "Research this.",
    });

    const result = await tool.handler({ input: "quantum computing" });
    expect(result).toContain("research result");
  });

  it("disposes child agent after completion", async () => {
    const mockDispose = vi.fn();
    vi.doMock("../../src/agent.js", () => ({
      Agent: {
        create: vi.fn().mockResolvedValue({
          send: vi.fn().mockResolvedValue({ wait: () => Promise.resolve({ result: "done" }) }),
          dispose: mockDispose,
        }),
      },
    }));

    const tool = defineSubAgent({
      name: "worker",
      description: "Works",
      instructions: "Work.",
    });
    await tool.handler({ input: "task" });
    expect(mockDispose).toHaveBeenCalledOnce();
  });

  it("disposes child agent even on error", async () => {
    const mockDispose = vi.fn();
    vi.doMock("../../src/agent.js", () => ({
      Agent: {
        create: vi.fn().mockResolvedValue({
          send: vi.fn().mockResolvedValue({ wait: () => Promise.reject(new Error("send failed")) }),
          dispose: mockDispose,
        }),
      },
    }));

    const tool = defineSubAgent({
      name: "worker",
      description: "Works",
      instructions: "Work.",
    });
    await expect(tool.handler({ input: "task" })).rejects.toThrow("send failed");
    expect(mockDispose).toHaveBeenCalledOnce();
  });

  it("uses custom model when specified", () => {
    const tool = defineSubAgent({
      name: "coder",
      description: "Codes",
      instructions: "Code.",
      model: "claude-opus-4",
    });
    expect(tool).toBeDefined();
  });

  it("throws MaxDelegationDepthError at depth limit (EC-2)", () => {
    expect(() =>
      defineSubAgent({ name: "deep", description: "Too deep", instructions: "Go deeper." }, 3),
    ).toThrow(MaxDelegationDepthError);
  });

  it("allows depth within limit", () => {
    expect(() =>
      defineSubAgent({ name: "ok", description: "OK depth", instructions: "OK." }, 2),
    ).not.toThrow();
  });

  it("handles empty input without crashing (EC-6)", async () => {
    vi.doMock("../../src/agent.js", () => ({
      Agent: {
        create: vi.fn().mockResolvedValue({
          send: vi.fn().mockResolvedValue({ wait: () => Promise.resolve({ result: "" }) }),
          dispose: vi.fn(),
        }),
      },
    }));

    const tool = defineSubAgent({
      name: "empty",
      description: "Handles empty",
      instructions: "Handle it.",
    });
    const result = await tool.handler({ input: "" });
    expect(result).toBe("");
  });

  it("returns (no response) when finalText is undefined", async () => {
    vi.doMock("../../src/agent.js", () => ({
      Agent: {
        create: vi.fn().mockResolvedValue({
          send: vi.fn().mockResolvedValue({ wait: () => Promise.resolve({ result: undefined }) }),
          dispose: vi.fn(),
        }),
      },
    }));

    const tool = defineSubAgent({
      name: "quiet",
      description: "Silent agent",
      instructions: "Be quiet.",
    });
    const result = await tool.handler({ input: "hello" });
    expect(result).toBe("(no response)");
  });

  it("respects custom maxDelegationDepth", () => {
    expect(() =>
      defineSubAgent(
        {
          name: "custom",
          description: "Custom depth",
          instructions: "Custom.",
          maxDelegationDepth: 5,
        },
        4,
      ),
    ).not.toThrow();

    expect(() =>
      defineSubAgent(
        {
          name: "custom",
          description: "Custom depth",
          instructions: "Custom.",
          maxDelegationDepth: 5,
        },
        5,
      ),
    ).toThrow(MaxDelegationDepthError);
  });
});
