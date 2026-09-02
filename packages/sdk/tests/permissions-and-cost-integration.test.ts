/**
 * M7 (SDK slice) — Integration Validation (Phase 4).
 *
 * Composes M7-4 (default-deny engine) + M7-5 (PermissionPlugin veto)
 * + M7-6 (formatCostUsd honest-null) in one flow.
 */

// By PACKAGE NAME, through the export map, which is the surface a consumer actually gets. This read
// `../../sdk-budget/src/format-cost.js` and crossed three boundaries in one line: the dependency was
// undeclared (it resolved only because the two packages sit side by side on disk), the export map
// was bypassed (`./src/format-cost.js` is not among sdk-budget's two published subpaths), and it
// read TypeScript source rather than the built output this repo's satellites are exercised through
// everywhere else. An integration test that composes two packages has to compose what they publish.
import { formatCostUsd } from "@theokit/sdk-budget";
import { describe, expect, it } from "vitest";
import { PermissionEngine, PermissionPlugin } from "../src/index.js";
import type { HookHandler, Plugin, PreToolCallDecision } from "../src/internal/plugins/types.js";

function handlerOf(plugin: Plugin): HookHandler {
  let handler: HookHandler | undefined;
  const ctx = {
    registerTool() {},
    registerCommand() {},
    on(hook: string, h: HookHandler) {
      if (hook === "pre_tool_call") handler = h;
    },
  };
  if (plugin.kind !== "general") throw new Error("expected general plugin");
  void plugin.register(ctx as never);
  if (handler === undefined) throw new Error("no handler");
  return handler;
}

describe("M7 SDK slice — full chain", () => {
  it("default-deny engine + plugin blocks unlisted, allows listed; cost renders honestly", async () => {
    const engine = new PermissionEngine([{ tool: "read_file", action: "allow" }], {
      defaultAction: "deny",
    });
    const handler = handlerOf(PermissionPlugin.create(engine));

    // Allowed tool passes.
    expect(await handler({ name: "read_file", args: {} })).toBeUndefined();
    // Unlisted tool is denied by the default-deny engine.
    const blocked = (await handler({ name: "shell_exec", args: {} })) as
      | PreToolCallDecision
      | undefined;
    expect(blocked?.block).toBe(true);

    // Honest-null cost rendering.
    expect(formatCostUsd(undefined)).toBe("—");
    expect(formatCostUsd(2.5)).toBe("$2.50");
  });
});
