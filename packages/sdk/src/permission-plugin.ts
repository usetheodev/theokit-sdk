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
import type { PermissionEngine, PermissionMode } from "./permission-engine.js";

/**
 * SE1 — context passed to the {@link PermissionGate}. Intentionally minimal for
 * SE1; `agentId`/`runId` (for audit logging) are a documented follow-up — they are
 * available on the raw `pre_tool_call` context and can be threaded in a later slice.
 */
export interface PermissionGateContext {
  /** The tool being gated. */
  readonly toolName: string;
  /** The active permission mode for this run. */
  readonly mode: PermissionMode;
}

/**
 * SE1 — the resolution of an `"ask"` verdict by the host gate. Fail-closed: an
 * absent gate, a throwing gate, and a `"deny"` decision all block. Arg rewrite
 * (`updatedInput`) is intentionally NOT supported yet — the `pre_tool_call` seam
 * is veto-only (`{ block, message }`); a future enhancement can extend it.
 */
export type PermissionGateDecision =
  | { readonly behavior: "allow" }
  | { readonly behavior: "deny"; readonly message?: string };

/**
 * SE1 — the enriched `canUseTool` gate (the Anthropic-parity shape). Invoked ONLY
 * on an `"ask"` verdict, it receives the tool name, its input args, and the run
 * {@link PermissionGateContext}, and resolves to allow/deny. May be async (a real
 * gate can prompt a human — the `pre_tool_call` seam awaits it).
 */
export type PermissionGate = (
  toolName: string,
  input: Record<string, unknown>,
  ctx: PermissionGateContext,
) => PermissionGateDecision | Promise<PermissionGateDecision>;

/** Options for {@link createPermissionPlugin}. */
export interface PermissionPluginOptions {
  /** Plugin name (default `"permission-engine"`). */
  readonly name?: string;
  /**
   * SE1 — the per-run {@link PermissionMode}. Threaded into `engine.evaluate`, so
   * `bypass` auto-allows the ask verdict (gate never consulted), `plan` blocks
   * mutations, etc. An explicit `deny` rule is immune to every mode. Default
   * `"default"` (rules decide; unmatched ⇒ fail-closed ask).
   */
  readonly mode?: PermissionMode;
  /**
   * SE1 — the enriched gate for the `"ask"` verdict. Preferred over {@link onAsk}.
   * Absent gate on an `ask` verdict ⇒ fail-closed block.
   */
  readonly canUseTool?: PermissionGate;
  /**
   * @deprecated since SE1 — use {@link canUseTool}, which receives `(toolName,
   * input, ctx)` and returns a typed decision. Honored only when `canUseTool` is
   * absent. Returns a veto (`{block,message}`) to deny or `undefined` to allow.
   */
  readonly onAsk?: (toolName: string) => PreToolCallDecision | undefined;
}

/**
 * Resolve an `"ask"` verdict via the gate (fail-closed). Extracted from the
 * register handler to keep its cognitive complexity in budget. Prefers
 * `canUseTool`; falls back to the deprecated `onAsk`; blocks when neither exists.
 */
async function resolveAsk(
  opts: PermissionPluginOptions,
  name: string,
  args: Record<string, unknown>,
  mode: PermissionMode,
): Promise<PreToolCallDecision | undefined> {
  if (opts.canUseTool !== undefined) {
    let decision: PermissionGateDecision;
    try {
      decision = await opts.canUseTool(name, args, { toolName: name, mode });
    } catch {
      // Fail-closed: a gate that throws must not silently allow.
      return { block: true, message: `permission gate error (fail-closed): ${name}` };
    }
    return decision.behavior === "deny"
      ? { block: true, message: decision.message ?? `denied: ${name}` }
      : undefined;
  }
  // Deprecated back-compat: honor onAsk (undefined = allow). Fail-closed (block)
  // only when NEITHER a gate nor onAsk was supplied.
  return opts.onAsk ? opts.onAsk(name) : { block: true, message: `requires approval: ${name}` };
}

/**
 * Build a `general` plugin that vetoes tool calls per the engine's verdict, under
 * the configured {@link PermissionMode}, resolving `ask` via the {@link canUseTool}
 * gate. Register it on an agent's plugin manager (same as the ACP permission plugin).
 */
function createPermissionPlugin(
  engine: PermissionEngine,
  opts: PermissionPluginOptions = {},
): Plugin {
  const mode: PermissionMode = opts.mode ?? "default";
  return definePlugin({
    name: opts.name ?? "permission-engine",
    version: "1.0.0",
    kind: "general",
    register(ctx) {
      ctx.on("pre_tool_call", async (rawCtx) => {
        const { name, args } = rawCtx as { name: string; args: Record<string, unknown> };
        // #55 — args gate rules on the command/args, not just the tool name.
        // SE1 — the mode adjusts the verdict (bypass/plan/acceptEdits); an explicit
        // `deny` rule is immune to every auto-approve mode.
        const action = engine.evaluate(name, args, mode);
        if (action === "deny") {
          return { block: true, message: `denied by permission engine: ${name}` };
        }
        if (action === "ask") return resolveAsk(opts, name, args, mode);
        return undefined;
      });
    },
  });
}

/** SE36 — `PermissionPlugin.create` replaces `createPermissionPlugin` (ADR 0015). @public */
export class PermissionPlugin {
  private constructor() {}
  static create(engine: PermissionEngine, opts: PermissionPluginOptions = {}): Plugin {
    return createPermissionPlugin(engine, opts);
  }
}
