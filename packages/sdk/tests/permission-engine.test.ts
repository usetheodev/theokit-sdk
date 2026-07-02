import { describe, expect, it } from "vitest";
import type { PermissionRule } from "../src/permission-engine.js";
import { PermissionEngine } from "../src/permission-engine.js";

describe("PermissionEngine", () => {
  it("defaults to ask (fail-closed) when no rules match (#55)", () => {
    const engine = new PermissionEngine([]);
    // #55 — the default is now fail-closed. Pass { defaultAction: "allow" } to opt out.
    expect(engine.evaluate("shell_exec")).toBe("ask");
  });

  it("matches exact string tool name", () => {
    const rules: PermissionRule[] = [{ tool: "shell_exec", action: "deny" }];
    const engine = new PermissionEngine(rules, { defaultAction: "allow" });
    expect(engine.evaluate("shell_exec")).toBe("deny");
    expect(engine.evaluate("read_file")).toBe("allow");
  });

  it("matches RegExp tool pattern", () => {
    const rules: PermissionRule[] = [{ tool: /^shell_/, action: "ask" }];
    const engine = new PermissionEngine(rules, { defaultAction: "allow" });
    expect(engine.evaluate("shell_exec")).toBe("ask");
    expect(engine.evaluate("shell_background")).toBe("ask");
    expect(engine.evaluate("read_file")).toBe("allow");
  });

  it("first match wins when multiple rules match", () => {
    const rules: PermissionRule[] = [
      { tool: "shell_exec", action: "deny" },
      { tool: /^shell_/, action: "allow" },
    ];
    const engine = new PermissionEngine(rules);
    // Exact match on first rule
    expect(engine.evaluate("shell_exec")).toBe("deny");
    // Only second rule matches
    expect(engine.evaluate("shell_background")).toBe("allow");
  });

  it("supports ask action", () => {
    const rules: PermissionRule[] = [{ tool: "write_file", action: "ask" }];
    const engine = new PermissionEngine(rules);
    expect(engine.evaluate("write_file")).toBe("ask");
  });
});
