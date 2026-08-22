import { describe, expect, it } from "vitest";
import { PermissionEngine } from "../src/permission-engine.js";

/**
 * #367 — a predicate arg matcher ran on a MISSING argument.
 *
 * `argMatches` guards `value === undefined` for the string and RegExp forms, with the comment
 * "missing arg never matches a declared predicate". The predicate branch returned one line ABOVE
 * that guard, so a declared predicate was invoked with `undefined`.
 *
 * Two consequences, and the first is a permission escape: a narrow predicate written to restrict
 * a call — `(v) => v !== "prod"` — returns `true` for `undefined`, yielding an EXPLICIT allow for
 * a call that supplied no argument at all. The caller wrote a matcher believing it could only ever
 * narrow, and it widened.
 */
describe("predicate matchers and a missing argument (#367)", () => {
  it("does not allow a call that supplied no argument at all", () => {
    // Reads as "anything except prod". A call with no `env` supplied nothing to compare, so it
    // must not satisfy the rule.
    const engine = new PermissionEngine([
      { tool: "deploy", args: { env: (v: unknown) => v !== "prod" }, action: "allow" },
    ]);

    expect(engine.evaluate("deploy", {})).not.toBe("allow");
  });

  it("still allows the call the predicate was written for", () => {
    // The accepted case (`testing.md` § 4.2). A guard that rejected every predicate rule would
    // pass the test above and silently stop every legitimate allow from matching.
    const engine = new PermissionEngine([
      { tool: "deploy", args: { env: (v: unknown) => v !== "prod" }, action: "allow" },
    ]);

    expect(engine.evaluate("deploy", { env: "staging" })).toBe("allow");
  });

  it("denies rather than throwing when a deny predicate meets a missing argument", () => {
    // `(v) => v.includes(...)` raises TypeError on undefined. Out of a permission gate, a thrown
    // TypeError is not a denial — it is an unhandled failure on the path whose whole job is to
    // decide authorization.
    const engine = new PermissionEngine([
      {
        tool: "shell",
        args: { command: (v: unknown) => (v as string).includes("rm") },
        action: "deny",
      },
    ]);

    expect(() => engine.evaluate("shell", {})).not.toThrow();
  });

  it("still denies the call the deny predicate was written for", () => {
    const engine = new PermissionEngine([
      {
        tool: "shell",
        args: { command: (v: unknown) => (v as string).includes("rm") },
        action: "deny",
      },
    ]);

    expect(engine.evaluate("shell", { command: "rm -rf /" })).toBe("deny");
  });
});
