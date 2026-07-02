/**
 * M7-4 — PermissionEngine default-deny.
 */
import { describe, expect, it } from "vitest";
import { PermissionEngine } from "../src/permission-engine.js";

describe("PermissionEngine defaultAction (M7-4)", () => {
  it("returns the configured defaultAction when no rule matches", () => {
    const engine = new PermissionEngine([], { defaultAction: "deny" });
    expect(engine.evaluate("anything")).toBe("deny");
  });

  it("defaults to ask (fail-closed) when no option is given (#55)", () => {
    // #55 — flipped from the previous fail-open "allow" default. A permission
    // engine that cannot positively allow must not silently allow.
    const engine = new PermissionEngine([]);
    expect(engine.evaluate("anything")).toBe("ask");
    // Opt back into fail-open explicitly:
    expect(new PermissionEngine([], { defaultAction: "allow" }).evaluate("anything")).toBe("allow");
  });

  it("first matching rule still wins over the defaultAction", () => {
    const engine = new PermissionEngine([{ tool: "read", action: "allow" }], {
      defaultAction: "deny",
    });
    expect(engine.evaluate("read")).toBe("allow");
    expect(engine.evaluate("write")).toBe("deny");
  });
});
