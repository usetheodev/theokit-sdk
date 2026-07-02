import { describe, expect, it } from "vitest";
import { PermissionEngine } from "../src/permission-engine.js";

/**
 * #55 — PermissionEngine gated on tool NAME only and defaulted fail-OPEN.
 * A `shell` allow rule could not distinguish `ls` from `rm -rf /`.
 *
 * RED (pre-fix): `PermissionRule` has no `args`; `evaluate` takes name only;
 * `defaultAction` defaults to "allow".
 */
describe("PermissionEngine argument gating + fail-closed default (#55)", () => {
  it("rule_denies_shell_with_rm_rf_args", () => {
    const engine = new PermissionEngine([
      { tool: "shell", args: { command: /rm\s+-rf/ }, action: "deny" },
    ]);
    expect(engine.evaluate("shell", { command: "rm -rf /" })).toBe("deny");
  });

  it("same_rule_passes_shell_with_ls", () => {
    const engine = new PermissionEngine(
      [{ tool: "shell", args: { command: /rm\s+-rf/ }, action: "deny" }],
      { defaultAction: "allow" },
    );
    // The rm-rf rule does not match `ls` → falls through to the (explicit) allow default.
    expect(engine.evaluate("shell", { command: "ls" })).toBe("allow");
  });

  it("default_is_fail_closed", () => {
    const engine = new PermissionEngine([]); // no rules, no explicit default
    // Pre-fix this returned "allow" (fail-open). Fixed → "ask" (fail-closed).
    expect(engine.evaluate("anything")).toBe("ask");
  });

  it("explicit_allow_default_still_honored", () => {
    const engine = new PermissionEngine([], { defaultAction: "allow" });
    expect(engine.evaluate("anything")).toBe("allow");
  });

  it("name_only_rules_still_work", () => {
    const engine = new PermissionEngine([{ tool: "danger", action: "deny" }], {
      defaultAction: "allow",
    });
    expect(engine.evaluate("danger")).toBe("deny");
    expect(engine.evaluate("safe")).toBe("allow");
  });

  it("arg_rule_with_missing_arg_does_not_match (EC-3)", () => {
    const engine = new PermissionEngine(
      [{ tool: "shell", args: { command: /rm/ }, action: "deny" }],
      { defaultAction: "allow" },
    );
    // Call has NO `command` arg → predicate fails → rule does not match, no throw.
    expect(engine.evaluate("shell", {})).toBe("allow");
    expect(engine.evaluate("shell")).toBe("allow");
  });

  it("string_and_predicate_arg_matchers", () => {
    const engine = new PermissionEngine(
      [
        { tool: "http", args: { method: "POST" }, action: "ask" },
        {
          tool: "http",
          args: { url: (v) => typeof v === "string" && v.startsWith("http://") },
          action: "deny",
        },
      ],
      { defaultAction: "allow" },
    );
    expect(engine.evaluate("http", { method: "POST", url: "https://x" })).toBe("ask");
    expect(engine.evaluate("http", { method: "GET", url: "http://insecure" })).toBe("deny");
    expect(engine.evaluate("http", { method: "GET", url: "https://ok" })).toBe("allow");
  });
});
