import { describe, expect, it } from "vitest";
import { ChatInputState } from "../../src/tui/chat-input.js";

describe("ChatInputState", () => {
  it("accumulates typed characters and submits", () => {
    const input = new ChatInputState();
    input.type("h");
    input.type("i");
    expect(input.getBuffer()).toBe("hi");

    const submitted = input.submit();
    expect(submitted).toBe("hi");
    expect(input.getBuffer()).toBe("");
  });

  it("returns null when submitting an empty buffer", () => {
    const input = new ChatInputState();
    expect(input.submit()).toBeNull();

    input.type("   ");
    expect(input.submit()).toBeNull();
  });

  it("supports backspace", () => {
    const input = new ChatInputState();
    input.type("abc");
    input.backspace();
    expect(input.getBuffer()).toBe("ab");
  });

  it("navigates history with up/down", () => {
    const input = new ChatInputState();
    input.type("first");
    input.submit();
    input.type("second");
    input.submit();

    input.historyUp();
    expect(input.getBuffer()).toBe("second");

    input.historyUp();
    expect(input.getBuffer()).toBe("first");

    input.historyDown();
    expect(input.getBuffer()).toBe("second");

    input.historyDown();
    // Back to live buffer (was empty after submit)
    expect(input.getBuffer()).toBe("");
  });
});
