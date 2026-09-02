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

describe("PermissionEngine — a rule about an argument the call did not supply (#367)", () => {
  // The guard these three cases protect is one line in argMatches, and NOTHING covered it: deleting
  // `if (value === undefined) return false;` left the whole suite green. The public docblock on
  // PermissionRule described the pre-fix behaviour for months after the fix, telling consumers to
  // guard every predicate by hand. Correcting the docblock without adding these would swap one
  // unverified claim for another.

  it("an allow rule whose predicate would accept undefined does NOT authorize an argument-less call", () => {
    // The unsafe direction. `(v) => v !== "prod"` is written to NARROW, and returns true for
    // undefined — so invoking it on a missing argument turned a narrowing rule into a widening one.
    const engine = new PermissionEngine(
      [{ tool: "shell", args: { command: (v: unknown) => v !== "prod" }, action: "allow" }],
      { defaultAction: "ask" },
    );
    expect(engine.evaluate("shell", {})).toBe("ask");
    expect(engine.evaluate("shell", { command: "ls" })).toBe("allow");
  });

  it("a deny rule whose predicate would throw on undefined does not throw out of the gate", () => {
    // The other direction, and worse: an unhandled TypeError on the path that decides authorization
    // is not a denial — it is a crash where a verdict was expected.
    const engine = new PermissionEngine(
      [
        {
          tool: "shell",
          args: { command: (v: unknown) => (v as string).includes("rm") },
          action: "deny",
        },
      ],
      { defaultAction: "allow" },
    );
    expect(() => engine.evaluate("shell", {})).not.toThrow();
    expect(engine.evaluate("shell", {})).toBe("allow");
    expect(engine.evaluate("shell", { command: "rm -rf /" })).toBe("deny");
  });

  it("holds for string and RegExp matchers too, so the rule is uniform", () => {
    const engine = new PermissionEngine(
      [
        { tool: "shell", args: { command: "ls" }, action: "allow" },
        { tool: "shell", args: { command: /^rm/ }, action: "deny" },
      ],
      { defaultAction: "ask" },
    );
    expect(engine.evaluate("shell", {})).toBe("ask");
  });
});
