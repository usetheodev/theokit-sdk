/**
 * M7-5 — `createPermissionPlugin`: wire a {@link PermissionEngine} into the
 * `definePlugin` `pre_tool_call` veto seam. This is the canonical exemplar that
 * gives `PermissionEngine` a real caller (it was previously exported-but-unwired):
 * on each tool call the engine's verdict maps to the veto contract —
 * `"deny"` -> block, `"ask"` -> the caller's `onAsk` resolver (or block, fail-closed),
 * `"allow"` -> pass.
 *
 * @public
 */

import { definePlugin } from "./internal/plugins/index.js";
import type { Plugin, PreToolCallDecision } from "./internal/plugins/types.js";
import type { PermissionEngine } from "./permission-engine.js";

/** Options for {@link createPermissionPlugin}. */
export interface PermissionPluginOptions {
  /** Plugin name (default `"permission-engine"`). */
  readonly name?: string;
  /**
   * Resolver for the `"ask"` verdict. Returns a veto (`{block,message}`) to deny
   * or `undefined` to allow. Default: fail-closed (block with "requires approval").
   */
  readonly onAsk?: (toolName: string) => PreToolCallDecision | undefined;
}

/**
 * Build a `general` plugin that vetoes tool calls per the engine's verdict.
 * Register it on an agent's plugin manager (same as the ACP permission plugin).
 */
export function createPermissionPlugin(
  engine: PermissionEngine,
  opts: PermissionPluginOptions = {},
): Plugin {
  return definePlugin({
    name: opts.name ?? "permission-engine",
    version: "1.0.0",
    kind: "general",
    register(ctx) {
      ctx.on("pre_tool_call", (rawCtx) => {
        const { name } = rawCtx as { name: string };
        const action = engine.evaluate(name);
        if (action === "deny") {
          return { block: true, message: `denied by permission engine: ${name}` };
        }
        if (action === "ask") {
          // If a resolver is provided, honor its verdict verbatim (undefined =
          // allow). Only fail-closed (block) when NO resolver was supplied.
          return opts.onAsk
            ? opts.onAsk(name)
            : { block: true, message: `requires approval: ${name}` };
        }
        return undefined;
      });
    },
  });
}
