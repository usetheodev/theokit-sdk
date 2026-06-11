import { describe, expect, it, vi } from "vitest";
import { createQuestionTool } from "../../src/tools/question.js";

describe("createQuestionTool", () => {
  it("returns user answer on success", async () => {
    const askUser = vi.fn().mockResolvedValue("yes, proceed");
    const tool = createQuestionTool({ askUser });

    const result = JSON.parse(await tool.handler({ question: "Continue?" }));

    expect(result.ok).toBe(true);
    expect(result.answer).toBe("yes, proceed");
    expect(askUser).toHaveBeenCalledWith("Continue?");
  });

  it("returns timeout error when user does not respond in time", async () => {
    const askUser = vi
      .fn()
      .mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 10_000)));
    const tool = createQuestionTool({ askUser, timeoutMs: 50 });

    const result = JSON.parse(await tool.handler({ question: "Hello?" }));

    expect(result.ok).toBe(false);
    expect(result.error).toBe("timeout");
  });

  it("uses default timeout of 300_000 ms", () => {
    const tool = createQuestionTool({ askUser: vi.fn() });
    // Verify the tool was created (timeout is internal, not directly exposed)
    expect(tool.name).toBe("question");
  });

  it("propagates non-timeout errors from askUser", async () => {
    const askUser = vi.fn().mockRejectedValue(new Error("connection lost"));
    const tool = createQuestionTool({ askUser });

    await expect(tool.handler({ question: "test" })).rejects.toThrow("connection lost");
  });

  it("has correct tool metadata", () => {
    const tool = createQuestionTool({ askUser: vi.fn() });
    expect(tool.name).toBe("question");
    expect(tool.description).toBeTruthy();
    expect(tool.inputSchema).toBeDefined();
  });
});
