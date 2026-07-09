import { describe, expect, it } from "vitest";

import {
  applyMode,
  type PermissionAction,
  PermissionEngine,
  type PermissionMode,
} from "../src/permission-engine.js";

/**
 * SE1 — PermissionMode is a PURE post-processor of the rule-engine verdict.
 *
 * Grounded in OpenCode (agents-as-rulesets, plan agent deny-all, dangerously-skip)
 * + Codex (AskForApproval: OnRequest default, Never, UnlessTrusted). Two
 * load-bearing rules BOTH projects enforce:
 *   (a) an explicit `deny` is immune to EVERY auto-approve path (bypass/acceptEdits);
 *   (b) `acceptEdits` (Codex UnlessTrusted) auto-approves the UNMATCHED/default
 *       verdict but STILL honors an explicit `ask` RULE (a caller gates a risky
 *       tool with an ask rule); only `bypass` (Never / dangerously-skip) turns an
 *       explicit `ask` into allow. Hence `applyMode` needs the `explicit` flag.
 *
 * TDD RED-first.
 */

describe("applyMode (SE1) — pure verdict post-processor", () => {
  it("default is identity for every verdict (backward-compatible)", () => {
    for (const v of ["allow", "deny", "ask"] as PermissionAction[]) {
      expect(applyMode(v, "default", true)).toBe(v);
      expect(applyMode(v, "default", false)).toBe(v);
    }
  });

  it("INVARIANT (a): a `deny` verdict is immune to every mode, explicit OR default", () => {
    for (const m of ["default", "plan", "acceptEdits", "bypass"] as PermissionMode[]) {
      expect(applyMode("deny", m, true)).toBe("deny"); // explicit deny rule
      // deny as the unmatched fallback (new PermissionEngine([], {defaultAction:"deny"}))
      // is ALSO immune — the guard runs before the explicit flag matters.
      expect(applyMode("deny", m, false)).toBe("deny");
    }
  });

  it("plan: allow rules pass; ask/unmatched become deny (read-only)", () => {
    expect(applyMode("allow", "plan", true)).toBe("allow");
    expect(applyMode("ask", "plan", true)).toBe("deny"); // explicit ask blocked
    expect(applyMode("ask", "plan", false)).toBe("deny"); // unmatched blocked
  });

  it("INVARIANT (b): acceptEdits auto-approves UNMATCHED but honors an explicit ask", () => {
    expect(applyMode("ask", "acceptEdits", false)).toBe("allow"); // unmatched → auto-accept
    expect(applyMode("ask", "acceptEdits", true)).toBe("ask"); // explicit ask → STILL ask
    expect(applyMode("allow", "acceptEdits", true)).toBe("allow");
  });

  it("bypass: everything (except deny) → allow, even an explicit ask", () => {
    expect(applyMode("ask", "bypass", true)).toBe("allow"); // explicit ask → allow (unlike acceptEdits)
    expect(applyMode("ask", "bypass", false)).toBe("allow");
    expect(applyMode("allow", "bypass", true)).toBe("allow");
  });
});

describe("PermissionEngine.evaluate with mode (SE1)", () => {
  const engine = new PermissionEngine([
    { tool: "read", action: "allow" },
    { tool: "shell", args: { command: /rm\s+-rf/ }, action: "deny" },
    { tool: "shell", action: "ask" }, // explicit "risky" gate
  ]);

  it("mode defaults to 'default' — backward-compatible", () => {
    expect(engine.evaluate("read")).toBe("allow");
    expect(engine.evaluate("shell", { command: "ls" })).toBe("ask");
    expect(engine.evaluate("unknown")).toBe("ask"); // fail-closed default (#55)
  });

  it("plan: mutations blocked (explicit ask + unmatched → deny), allow rule kept", () => {
    expect(engine.evaluate("read", undefined, "plan")).toBe("allow");
    expect(engine.evaluate("shell", { command: "ls" }, "plan")).toBe("deny");
    expect(engine.evaluate("unknown", undefined, "plan")).toBe("deny");
  });

  it("acceptEdits: unmatched auto-accepted, explicit ask STILL asks, deny immune", () => {
    expect(engine.evaluate("unknown", undefined, "acceptEdits")).toBe("allow"); // unmatched
    expect(engine.evaluate("shell", { command: "ls" }, "acceptEdits")).toBe("ask"); // explicit ask honored
    expect(engine.evaluate("shell", { command: "rm -rf /" }, "acceptEdits")).toBe("deny"); // deny immune
  });

  it("bypass: all → allow except explicit deny (invariant)", () => {
    expect(engine.evaluate("shell", { command: "ls" }, "bypass")).toBe("allow"); // explicit ask → allow
    expect(engine.evaluate("unknown", undefined, "bypass")).toBe("allow");
    expect(engine.evaluate("shell", { command: "rm -rf /" }, "bypass")).toBe("deny"); // deny STILL fires
  });
});
