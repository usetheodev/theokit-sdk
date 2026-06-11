import { describe, expect, it } from "vitest";
import { darkTheme, getTheme, lightTheme } from "../../src/tui/theme.js";

describe("getTheme", () => {
  it("returns dark theme by default", () => {
    expect(getTheme()).toBe(darkTheme);
    expect(getTheme(undefined)).toBe(darkTheme);
  });

  it("returns light theme when requested", () => {
    expect(getTheme("light")).toBe(lightTheme);
  });

  it("falls back to dark theme for unknown names", () => {
    expect(getTheme("neon")).toBe(darkTheme);
  });
});
