import { describe, expect, it } from "vitest";

import type { Plugin } from "../src/internal/plugins/types.js";
import { PermissionEngine, type PermissionMode } from "../src/permission-engine.js";
import { type PermissionGateDecision, PermissionPlugin } from "../src/permission-plugin.js";

/**
 * SE1 (adversarial-review gap closure):
 *  - resolveAsk must FAIL-CLOSED on any non-`allow` gate decision (was fail-open:
 *    only an exact `"deny"` blocked, so a malformed/undefined return allowed).
 *  - a global-flag RegExp arg matcher must be deterministic across calls (its
 *    `lastIndex` was mutating → alternating verdicts).
 *  - `bypassPermissions` is accepted as the Anthropic-exact alias of `bypass`.
 */

async function drive(
  plugin: ReturnType<typeof PermissionPlugin.create>,
  name: string,
  args: Record<string, unknown> = {},
): Promise<{ block: true; message: string } | undefined> {
  let handler: ((c: unknown) => unknown) | undefined;
  const ctx = {
    on: (event: string, h: (c: unknown) => unknown) => {
      if (event === "pre_tool_call") handler = h;
    },
  };
  void (plugin as Extract<Plugin, { kind: "general" }>).register(ctx as never);
  const decision = await handler?.({ name, args, agentId: "a", runId: "r" });
  return decision as { block: true; message: string } | undefined;
}

describe("SE1 — resolveAsk fail-closed on malformed gate decision", () => {
  const askEngine = () => new PermissionEngine([{ tool: "write", action: "ask" }]);

  it("blocks when canUseTool returns a non-allow (e.g. wrong-shaped) decision", async () => {
    const plugin = PermissionPlugin.create(askEngine(), {
      canUseTool: () => ({ behavior: "ask" }) as unknown as PermissionGateDecision,
    });
    expect((await drive(plugin, "write"))?.block).toBe(true);
  });

  it("blocks when canUseTool returns undefined", async () => {
    const plugin = PermissionPlugin.create(askEngine(), {
      canUseTool: () => undefined as unknown as PermissionGateDecision,
    });
    expect((await drive(plugin, "write"))?.block).toBe(true);
  });

  it("allows ONLY on an explicit allow decision", async () => {
    const plugin = PermissionPlugin.create(askEngine(), {
      canUseTool: () => ({ behavior: "allow" }),
    });
    expect(await drive(plugin, "write")).toBeUndefined();
  });
});

describe("SE1 — per-run PermissionMode threaded via the pre_tool_call context", () => {
  const driveWithMode = async (
    plugin: ReturnType<typeof PermissionPlugin.create>,
    name: string,
    mode: PermissionMode,
  ): Promise<{ block: true } | undefined> => {
    let handler: ((c: unknown) => unknown) | undefined;
    void (plugin as Extract<Plugin, { kind: "general" }>).register({
      on: (event: string, h: (c: unknown) => unknown) => {
        if (event === "pre_tool_call") handler = h;
      },
    } as never);
    return (await handler?.({
      name,
      args: {},
      agentId: "a",
      runId: "r",
      permissionMode: mode,
    })) as { block: true } | undefined;
  };

  it("honors the run's permissionMode over the construction-time mode", async () => {
    // Constructed with `default`; an `ask` verdict + no gate ⇒ fail-closed block.
    const engine = new PermissionEngine([{ tool: "write", action: "ask" }]);
    const plugin = PermissionPlugin.create(engine, { mode: "default" });

    // Same plugin, but THIS run declares `bypass` ⇒ the ask verdict auto-allows.
    expect(await driveWithMode(plugin, "write", "bypass")).toBeUndefined();
    // A run declaring `plan` (read-only) ⇒ the ask verdict is denied.
    expect((await driveWithMode(plugin, "write", "plan"))?.block).toBe(true);
  });
});

describe("SE1 — global-flag RegExp arg matcher is deterministic", () => {
  it("returns the same verdict across repeated identical calls", () => {
    const engine = new PermissionEngine([
      { tool: "shell", args: { command: /rm/g }, action: "deny" },
    ]);
    const first = engine.evaluate("shell", { command: "rm -rf /" });
    const second = engine.evaluate("shell", { command: "rm -rf /" });
    expect(first).toBe("deny");
    expect(second).toBe("deny");
  });
});

describe("SE1 — bypassPermissions alias (Anthropic-exact)", () => {
  it("behaves identically to bypass (auto-allow except explicit deny)", () => {
    const engine = new PermissionEngine([{ tool: "read", action: "ask" }]);
    expect(engine.evaluate("read", {}, "bypassPermissions" as PermissionMode)).toBe("allow");

    const denyEngine = new PermissionEngine([{ tool: "danger", action: "deny" }]);
    expect(denyEngine.evaluate("danger", {}, "bypassPermissions" as PermissionMode)).toBe("deny");
  });
});
