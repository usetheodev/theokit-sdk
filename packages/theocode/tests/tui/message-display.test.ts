import { describe, expect, it } from "vitest";
import { formatMessageForDisplay, formatToolResult } from "../../src/tui/message-display.js";
import { darkTheme } from "../../src/tui/theme.js";

describe("formatMessageForDisplay", () => {
  it("formats a user message", () => {
    const result = formatMessageForDisplay(
      { role: "user", content: "hello", timestamp: Date.now() },
      darkTheme,
    );
    expect(result.prefix).toBe("You");
    expect(result.body).toBe("hello");
    expect(result.color).toBe(darkTheme.userPrefix);
  });

  it("formats an assistant message", () => {
    const result = formatMessageForDisplay(
      { role: "assistant", content: "hi back", timestamp: Date.now() },
      darkTheme,
    );
    expect(result.prefix).toBe("Theo");
    expect(result.color).toBe(darkTheme.assistantPrefix);
  });

  it("uses toolName as prefix when present", () => {
    const result = formatMessageForDisplay(
      { role: "tool", content: "output", timestamp: Date.now(), toolName: "bash" },
      darkTheme,
    );
    expect(result.prefix).toBe("[bash]");
  });

  it("falls back to muted color for unknown roles", () => {
    const result = formatMessageForDisplay(
      { role: "custom", content: "x", timestamp: Date.now() },
      darkTheme,
    );
    expect(result.color).toBe(darkTheme.muted);
  });
});

describe("formatToolResult", () => {
  it("formats a successful tool result", () => {
    const result = formatToolResult("grep", "3 matches", "success");
    expect(result.prefix).toBe("[OK] grep");
    expect(result.body).toBe("3 matches");
  });

  it("formats a failed tool result", () => {
    const result = formatToolResult("bash", "exit 1", "error");
    expect(result.prefix).toBe("[ERROR] bash");
  });
});
