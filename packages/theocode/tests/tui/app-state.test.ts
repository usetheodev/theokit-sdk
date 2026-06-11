import { describe, expect, it } from "vitest";
import { AppState } from "../../src/tui/app.js";

describe("AppState", () => {
  it("starts in chat mode with default model", () => {
    const state = new AppState();
    expect(state.mode).toBe("chat");
    expect(state.modelId).toBe("anthropic/claude-sonnet-4");
    expect(state.sessionId).toBeNull();
  });

  it("switches mode and returns to chat on setSession", () => {
    const state = new AppState();
    state.switchMode("sessionSelect");
    expect(state.mode).toBe("sessionSelect");

    state.setSession("s1");
    expect(state.sessionId).toBe("s1");
    expect(state.mode).toBe("chat");
  });

  it("returns to chat mode on setModel", () => {
    const state = new AppState();
    state.switchMode("modelSelect");
    state.setModel("openai/gpt-4o");
    expect(state.modelId).toBe("openai/gpt-4o");
    expect(state.mode).toBe("chat");
  });
});
