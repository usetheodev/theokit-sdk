import { describe, expect, it } from "vitest";
import { DEFAULT_KEYMAP, formatKeymapHelp, resolveKeyAction } from "../../src/tui/keymap.js";

describe("resolveKeyAction", () => {
  it("resolves a known key to its action", () => {
    expect(resolveKeyAction("ctrl+c")).toBe("exit");
    expect(resolveKeyAction("enter")).toBe("submit");
    expect(resolveKeyAction("ctrl+p")).toBe("togglePlan");
  });

  it("returns null for an unknown key", () => {
    expect(resolveKeyAction("f12")).toBeNull();
  });

  it("accepts a custom keymap", () => {
    const custom = [{ key: "f1", action: "help" as const, description: "Help" }];
    expect(resolveKeyAction("f1", custom)).toBe("help");
    expect(resolveKeyAction("ctrl+c", custom)).toBeNull();
  });
});

describe("formatKeymapHelp", () => {
  it("formats default keymap as aligned lines", () => {
    const help = formatKeymapHelp();
    const lines = help.split("\n");
    expect(lines.length).toBe(DEFAULT_KEYMAP.length);
    expect(lines[0]).toContain("ctrl+c");
    expect(lines[0]).toContain("Exit TheoCode");
  });
});
