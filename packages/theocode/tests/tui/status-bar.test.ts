import { describe, expect, it } from "vitest";
import { formatStatusBar } from "../../src/tui/status-bar.js";

describe("formatStatusBar", () => {
  const data = {
    model: "claude-sonnet-4",
    session: "Fix login",
    tokens: 1234,
    cost: 0.0056,
    mode: "chat",
  };

  it("formats a complete status bar", () => {
    const bar = formatStatusBar(data, 120);
    expect(bar).toContain("[chat]");
    expect(bar).toContain("claude-sonnet-4");
    expect(bar).toContain("1234 tok");
    expect(bar).toContain("$0.0056");
  });

  it("truncates when exceeding maxWidth", () => {
    const bar = formatStatusBar(data, 20);
    expect(bar.length).toBe(20);
    expect(bar.endsWith("\u2026")).toBe(true);
  });

  it("omits cost when undefined", () => {
    const bar = formatStatusBar({ ...data, cost: undefined }, 120);
    expect(bar).not.toContain("$");
  });
});
