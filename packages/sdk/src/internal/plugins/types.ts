/**
 * Plugin contract types (T1.1, ADRs D97-D101).
 *
 * Discriminated union by `kind`:
 *   - `"general"` — registers tools/hooks/commands via `register(ctx)`.
 *   - `"model-provider"` — declares a `ProviderProfile` consumed by router.
 *   - `"memory"` — supplies a memory provider factory.
 *
 * Hooks are a fixed enum (D100) to prevent sprawl; `pre_tool_call` supports
 * veto via `{ block: true, message }` (D101) so plugins can implement safety
 * guards without crashing the agent loop.
 *
 * @public
 */

import type { CustomTool } from "../../types/agent.js";
import type { ProviderProfile } from "../providers/types.js";

export type HookName =
  | "pre_tool_call"
  | "post_tool_call"
  | "pre_llm_call"
  | "post_llm_call"
  | "on_session_start"
  | "on_session_end"
  | "transform_tool_result"
  | "transform_llm_output";

export interface PreToolCallContext {
  name: string;
  args: Record<string, unknown>;
  agentId: string;
  runId: string;
}

export interface PreToolCallDecision {
  block: true;
  message: string;
}

export type HookHandler = (ctx: unknown) => unknown | Promise<unknown>;

export type CommandHandler = (args: Record<string, unknown>) => Promise<string> | string;

export interface CommandOptions {
  description?: string;
}

export interface PluginContext {
  /** Register a custom tool. Equivalent to passing in `AgentOptions.tools`. */
  registerTool(tool: CustomTool): void;
  /** Register a slash-command-style handler. Consumed by CLI/bot wrappers; NOT used by the agent loop. */
  registerCommand(name: string, handler: CommandHandler, opts?: CommandOptions): void;
  /** Attach a hook handler. `pre_tool_call` supports veto via `PreToolCallDecision`. */
  on(hook: HookName, handler: HookHandler): void;
  /** Inject a user/system message into the next agent turn. v1 supports only `on_session_start` context. */
  injectMessage(content: string, role?: "user" | "system"): void;
}

interface BasePlugin {
  name: string;
  version: string;
}

/**
 * Memory provider factory shape. Forward declaration — full Memory plugin
 * support is out of scope for the agent-extension plan but the kind is
 * already in the union so the discriminator stays exhaustive.
 *
 * @internal
 */
export type MemoryProviderFactory = (cwd: string) => unknown;

export type Plugin =
  | (BasePlugin & {
      kind: "general";
      register: (ctx: PluginContext) => void | Promise<void>;
    })
  | (BasePlugin & {
      kind: "model-provider";
      profile: ProviderProfile;
    })
  | (BasePlugin & {
      kind: "memory";
      createProvider: MemoryProviderFactory;
    });

/**
 * Identity helper for plugin authors. TS-only convenience — preserves
 * inferred type without forcing manual `Plugin` annotation.
 *
 * @public
 */
export function definePlugin<P extends Plugin>(p: P): P {
  return p;
}
