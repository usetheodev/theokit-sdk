/**
 * T4.1 — permission-plugin tests.
 *
 * Tests the askWithTimeout-style flow by exercising the plugin's registered
 * `pre_tool_call` hook via a mock plugin manager.
 */

import type * as acp from "@agentclientprotocol/sdk";
import type { SDKAgent } from "@theokit/sdk";
import { describe, expect, it, vi } from "vitest";
import { installPermissionPlugin } from "../src/permission-plugin.js";

interface RegisteredHook {
  hook: string;
  handler: (ctx: unknown) => unknown | Promise<unknown>;
}

function makeAgentWithMockPluginManager(): {
  agent: SDKAgent;
  hooks: RegisteredHook[];
} {
  const hooks: RegisteredHook[] = [];
  const mockManager = {
    register: vi.fn((plugin: unknown) => {
      // emulate plugin context
      const ctx = {
        on(hook: string, handler: (c: unknown) => unknown | Promise<unknown>): void {
          hooks.push({ hook, handler });
        },
        registerTool: vi.fn(),
        registerCommand: vi.fn(),
        injectMessage: vi.fn(),
      };
      (plugin as { register: (c: unknown) => void }).register(ctx);
    }),
  };
  const agent = {
    agentId: "a-1",
    pluginManager: () => mockManager,
  } as unknown as SDKAgent;
  return { agent, hooks };
}

function fakeConn(
  respond: (req: acp.RequestPermissionRequest) => Promise<acp.RequestPermissionResponse>,
): acp.AgentSideConnection {
  return {
    requestPermission: vi.fn(respond),
  } as unknown as acp.AgentSideConnection;
}

describe("installPermissionPlugin", () => {
  it("plugin_deny_mode_blocks_immediately", async () => {
    const { agent, hooks } = makeAgentWithMockPluginManager();
    const conn = fakeConn(async () => {
      throw new Error("should not be called");
    });
    await installPermissionPlugin(agent, {
      conn,
      sessionId: "s-1",
      mode: "deny",
      trustedTools: new Set(),
      timeoutMs: 1000,
    });
    expect(hooks).toHaveLength(1);
    const result = (await hooks[0]?.handler({ name: "read_file", args: {} })) as
      | { block: true; message: string }
      | undefined;
    expect(result).toBeDefined();
    expect(result?.block).toBe(true);
    expect(result?.message).toMatch(/permissionDefault=deny/);
    // TQ-04 — deny short-circuits before any ACP round-trip.
    expect(conn.requestPermission).not.toHaveBeenCalled();
  });

  it("plugin_ask_mode_sends_request_and_blocks_on_deny", async () => {
    const { agent, hooks } = makeAgentWithMockPluginManager();
    const conn = fakeConn(async () => ({
      outcome: { outcome: "selected", optionId: "deny" },
    }));
    await installPermissionPlugin(agent, {
      conn,
      sessionId: "s-1",
      mode: "ask",
      trustedTools: new Set(),
      timeoutMs: 1000,
    });
    const result = (await hooks[0]?.handler({ name: "write_file", args: {} })) as
      | { block: true; message: string }
      | undefined;
    expect(result?.block).toBe(true);
    expect(result?.message).toMatch(/denied by user/);
    expect(conn.requestPermission).toHaveBeenCalledTimes(1);
  });

  it("plugin_ask_mode_allows_on_allow_response", async () => {
    const { agent, hooks } = makeAgentWithMockPluginManager();
    const conn = fakeConn(async () => ({
      outcome: { outcome: "selected", optionId: "allow" },
    }));
    await installPermissionPlugin(agent, {
      conn,
      sessionId: "s-1",
      mode: "ask",
      trustedTools: new Set(),
      timeoutMs: 1000,
    });
    const result = await hooks[0]?.handler({ name: "write_file", args: {} });
    expect(result).toBeUndefined();
  });

  it("plugin_ask_mode_blocks_on_cancelled", async () => {
    const { agent, hooks } = makeAgentWithMockPluginManager();
    const conn = fakeConn(async () => ({ outcome: { outcome: "cancelled" } }));
    await installPermissionPlugin(agent, {
      conn,
      sessionId: "s-1",
      mode: "ask",
      trustedTools: new Set(),
      timeoutMs: 1000,
    });
    const result = (await hooks[0]?.handler({ name: "write_file", args: {} })) as
      | { block: true; message: string }
      | undefined;
    expect(result?.block).toBe(true);
    expect(result?.message).toMatch(/cancelled/);
  });

  it("plugin_ask_mode_blocks_on_connection_throw", async () => {
    const { agent, hooks } = makeAgentWithMockPluginManager();
    const conn = fakeConn(async () => {
      throw new Error("disconnected");
    });
    await installPermissionPlugin(agent, {
      conn,
      sessionId: "s-1",
      mode: "ask",
      trustedTools: new Set(),
      timeoutMs: 1000,
    });
    const result = (await hooks[0]?.handler({ name: "write_file", args: {} })) as
      | { block: true; message: string }
      | undefined;
    expect(result?.block).toBe(true);
    expect(result?.message).toMatch(/client disconnected/);
  });

  it("plugin_ask_mode_blocks_on_timeout (EC-2)", async () => {
    const { agent, hooks } = makeAgentWithMockPluginManager();
    // requestPermission never resolves
    const conn = fakeConn(() => new Promise(() => undefined));
    await installPermissionPlugin(agent, {
      conn,
      sessionId: "s-1",
      mode: "ask",
      trustedTools: new Set(),
      timeoutMs: 50,
    });
    const result = (await hooks[0]?.handler({ name: "write_file", args: {} })) as
      | { block: true; message: string }
      | undefined;
    expect(result?.block).toBe(true);
    expect(result?.message).toMatch(/timed out after 50ms/);
  });

  it("plugin_trusted_tools_bypass_ask", async () => {
    const { agent, hooks } = makeAgentWithMockPluginManager();
    const conn = fakeConn(async () => {
      throw new Error("should not be called");
    });
    await installPermissionPlugin(agent, {
      conn,
      sessionId: "s-1",
      mode: "ask",
      trustedTools: new Set(["read_file"]),
      timeoutMs: 1000,
    });
    const result = await hooks[0]?.handler({ name: "read_file", args: {} });
    expect(result).toBeUndefined();
    expect(conn.requestPermission).not.toHaveBeenCalled();
  });

  it("SEC-M0-03: FAILS CLOSED (throws) when no plugin manager AND mode is deny/ask", async () => {
    const agent = { agentId: "a-1" } as unknown as SDKAgent;
    // A security control that cannot be enforced must refuse, not run ungated.
    await expect(
      installPermissionPlugin(agent, {
        conn: {} as unknown as acp.AgentSideConnection,
        sessionId: "s-1",
        mode: "deny",
        trustedTools: new Set(),
        timeoutMs: 1000,
      }),
    ).rejects.toMatchObject({ code: "permission_enforcement_unavailable" });
  });
});
