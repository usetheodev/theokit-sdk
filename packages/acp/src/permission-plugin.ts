/**
 * ACP tool permission plugin — bridges ACP `requestPermission` to our SDK
 * `pre_tool_call` veto hook (D101, D355, EC-2).
 *
 * Modes:
 *  - `auto`  — pass-through (plugin NOT installed in this mode)
 *  - `deny`  — block every tool call
 *  - `ask`   — round-trip via `conn.requestPermission` with timeout (EC-2)
 *
 * @internal
 */

import { randomUUID } from "node:crypto";
import type * as acp from "@agentclientprotocol/sdk";
import { definePlugin, type SDKAgent } from "@theokit/sdk";
import { toolKind } from "./translator.js";
import type { PermissionMode } from "./types.js";

interface PermissionPluginArgs {
  conn: acp.AgentSideConnection;
  sessionId: string;
  mode: PermissionMode;
  trustedTools: Set<string>;
  timeoutMs: number;
}

interface VetoDecision {
  block: true;
  message: string;
}

async function askWithTimeout(
  args: PermissionPluginArgs,
  toolName: string,
): Promise<VetoDecision | undefined> {
  const toolCallId = `acp-perm-${randomUUID()}`;
  const reqPromise = args.conn.requestPermission({
    sessionId: args.sessionId,
    toolCall: {
      toolCallId,
      title: toolName,
      kind: toolKind(toolName),
      status: "pending",
    },
    options: [
      { optionId: "allow", name: "Allow", kind: "allow_once" },
      { optionId: "deny", name: "Deny", kind: "reject_once" },
    ],
  });

  let timeoutHandle: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error("permission_timeout"));
    }, args.timeoutMs);
  });

  let response: acp.RequestPermissionResponse;
  try {
    response = (await Promise.race([reqPromise, timeoutPromise])) as acp.RequestPermissionResponse;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "permission_timeout") {
      return { block: true, message: `permission timed out after ${args.timeoutMs}ms` };
    }
    return { block: true, message: `permission request failed (client disconnected?): ${msg}` };
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  }

  const outcome = response.outcome;
  if (outcome.outcome === "cancelled") {
    return { block: true, message: "permission cancelled by client" };
  }
  if (outcome.outcome === "selected" && outcome.optionId === "deny") {
    return { block: true, message: "denied by user" };
  }
  return undefined;
}

/**
 * Install the permission plugin on an SDK agent. Idempotent — calling on the
 * same agent twice replaces the prior listener (per the SDK's pre_tool_call
 * subscription contract).
 */
export function installPermissionPlugin(agent: SDKAgent, args: PermissionPluginArgs): void {
  const plugin = definePlugin({
    name: `acp-permission-${args.sessionId}`,
    version: "1.0.0",
    kind: "general",
    register(ctx) {
      ctx.on("pre_tool_call", async (rawCtx) => {
        const event = rawCtx as { name: string; args: Record<string, unknown> };
        if (args.mode === "deny") {
          return { block: true, message: "denied (permissionDefault=deny)" };
        }
        if (args.trustedTools.has(event.name)) {
          return undefined;
        }
        // mode === "ask"
        return askWithTimeout(args, event.name);
      });
    },
  });

  // The agent's plugin manager is exposed via `pluginManager()` on LocalAgent.
  // The plugin is registered for the lifetime of the session — adequate for
  // ACP's one-process-per-session model (D356).
  const agentLike = agent as SDKAgent & {
    pluginManager?: () => {
      register?: (p: unknown) => void;
      initialize?: (plugins: unknown[]) => Promise<void>;
    };
  };
  const mgr = agentLike.pluginManager?.();
  if (mgr === undefined) {
    return; // CloudAgent — no plugin manager, no permission flow available
  }
  if (typeof mgr.register === "function") {
    mgr.register(plugin);
  } else if (typeof mgr.initialize === "function") {
    void mgr.initialize([plugin]);
  }
}
