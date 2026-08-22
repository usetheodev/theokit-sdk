import { describe, expect, it, vi } from "vitest";

import type { Plugin } from "../src/internal/plugins/types.js";
import { PermissionEngine } from "../src/permission-engine.js";
import { type PermissionGateDecision, PermissionPlugin } from "../src/permission-plugin.js";

/*
 * SE1 — `PermissionPlugin` gains a `mode` + an enriched async `canUseTool`
 * gate that receives `(toolName, input, ctx)` (vs the old `onAsk(toolName)`), and
 * resolves the `ask` verdict to allow/deny. Fail-closed: an absent gate, a
 * throwing gate, and a `deny` gate all block. `onAsk` stays as a `@deprecated`
 * back-compat fallback. Grounded in a peer project/Codex (host resolver, default-deny).
 *
 * TDD RED-first.
 */

/** Drive the plugin's registered `pre_tool_call` handler directly. */
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
  const decision = await handler!({ name, args, agentId: "a", runId: "r" });
  return decision as { block: true; message: string } | undefined;
}

const engine = new PermissionEngine([
  { tool: "read", action: "allow" },
  { tool: "shell", args: { command: /rm\s+-rf/ }, action: "deny" },
  { tool: "shell", action: "ask" },
]);

describe("PermissionPlugin — enriched gate (SE1)", () => {
  it("allow verdict passes (no block)", async () => {
    const p = PermissionPlugin.create(engine, { canUseTool: async () => ({ behavior: "allow" }) });
    expect(await drive(p, "read")).toBeUndefined();
  });

  it("deny verdict blocks (rule engine), gate not even consulted", async () => {
    const canUseTool = vi.fn(async () => ({ behavior: "allow" }) as PermissionGateDecision);
    const p = PermissionPlugin.create(engine, { canUseTool });
    const d = await drive(p, "shell", { command: "rm -rf /" });
    expect(d?.block).toBe(true);
    expect(canUseTool).not.toHaveBeenCalled();
  });

  it("ask verdict → canUseTool receives (toolName, input, ctx); allow → pass", async () => {
    const canUseTool = vi.fn(async () => ({ behavior: "allow" }) as PermissionGateDecision);
    const p = PermissionPlugin.create(engine, { canUseTool });
    expect(await drive(p, "shell", { command: "ls" })).toBeUndefined();
    expect(canUseTool).toHaveBeenCalledWith(
      "shell",
      { command: "ls" },
      {
        toolName: "shell",
        mode: "default",
      },
    );
  });

  it("ask verdict → gate deny blocks with the gate's message", async () => {
    const p = PermissionPlugin.create(engine, {
      canUseTool: async () => ({ behavior: "deny", message: "nope" }),
    });
    const d = await drive(p, "shell", { command: "ls" });
    expect(d?.block).toBe(true);
    expect(d?.message).toContain("nope");
  });

  it("FAIL-CLOSED: a throwing gate blocks", async () => {
    const p = PermissionPlugin.create(engine, {
      canUseTool: async () => {
        throw new Error("boom");
      },
    });
    const d = await drive(p, "shell", { command: "ls" });
    expect(d?.block).toBe(true);
  });

  it("FAIL-CLOSED: no gate + no onAsk on an ask verdict blocks", async () => {
    const p = PermissionPlugin.create(engine, {});
    const d = await drive(p, "shell", { command: "ls" });
    expect(d?.block).toBe(true);
  });

  it("mode is threaded into evaluate: bypass allows an ask-verdict tool without the gate", async () => {
    const canUseTool = vi.fn(async () => ({ behavior: "deny" }) as PermissionGateDecision);
    const p = PermissionPlugin.create(engine, { mode: "bypass", canUseTool });
    // bypass turns the shell 'ask' into 'allow' → gate never consulted, passes.
    expect(await drive(p, "shell", { command: "ls" })).toBeUndefined();
    expect(canUseTool).not.toHaveBeenCalled();
    // but the explicit deny rule still fires under bypass:
    expect((await drive(p, "shell", { command: "rm -rf /" }))?.block).toBe(true);
  });

  it("deprecated onAsk still honored when canUseTool is absent", async () => {
    const p = PermissionPlugin.create(engine, {
      onAsk: (name) => (name === "shell" ? undefined : { block: true, message: "x" }),
    });
    // onAsk returns undefined (allow) for shell:
    expect(await drive(p, "shell", { command: "ls" })).toBeUndefined();
  });
});
