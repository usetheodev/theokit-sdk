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

// Import `CustomTool` from the leaf `agent-prims.ts` where it is DEFINED (not via
// the `types/agent.ts` re-export) so this module does not close a type-only import
// cycle `types/agent → plugins/types → types/agent`.
import type { CustomTool } from "../../types/agent-prims.js";
import type { MemoryAdapter } from "../../types/memory-adapter.js";
import type { ProviderProfile } from "../providers/types.js";

export type HookName =
  | "pre_tool_call"
  | "post_tool_call"
  | "pre_llm_call"
  | "post_llm_call"
  | "on_session_start"
  | "on_session_end"
  | "transform_tool_result"
  | "transform_llm_output"
  // Memory adapter hooks (ADRs D141 / D145).
  | "pre_user_send"
  | "post_assistant_reply";

export interface PreToolCallContext {
  name: string;
  args: Record<string, unknown>;
  agentId: string;
  runId: string;
  /**
   * SE1 — the run's resolved `PermissionMode` (from `SendOptions.permissionMode`
   * ?? `AgentOptions.permissionMode`), threaded so a permission-style plugin can
   * gate per-run rather than at construction time. Absent ⇒ the plugin's own
   * default applies. Ignored by non-permission plugins.
   */
  permissionMode?: import("../../permission-engine.js").PermissionMode;
}

export interface PreToolCallDecision {
  block: true;
  message: string;
}

/**
 * #65 — a 2nd argument passed to a tool handler, carrying the run's cancellation
 * signal (ties into #58) so a cooperative tool can stop when the run is
 * cancelled. Optional and additive — existing single-arg handlers are unaffected.
 * (requestConfirmation/requestCredential are a documented follow-up.)
 *
 * @public
 */
export interface ToolContext {
  signal?: AbortSignal;
}

/** #65 — context for the `post_tool_call` hook (fired after a tool runs). @public */
export interface PostToolCallContext {
  name: string;
  args: Record<string, unknown>;
  result: { stdout: string; stderr: string; exitCode?: number | null };
  agentId: string;
  runId: string;
}

/** #65 — context for the `pre_llm_call` / `post_llm_call` hooks. @public */
export interface LlmCallContext {
  agentId: string;
  runId: string;
  /** Iteration index (0-based) of the current turn, when available. */
  iteration?: number;
}

/** #65 — context for the `on_session_start` / `on_session_end` hooks. @public */
export interface SessionLifecycleContext {
  agentId: string;
  runId: string;
}

/** #65 — context for the `transform_tool_result` / `transform_llm_output` hooks. @public */
export interface TransformContext {
  agentId: string;
  runId: string;
}

/**
 * Context passed to `pre_user_send` hook handlers (ADR D145).
 *
 * @public
 */
export interface PreUserSendContext {
  prompt: string;
  agentId: string;
  runId: string;
  /** Caller-supplied memory context, flowing through from `AgentOptions.memoryContext`. */
  memoryContext?: import("../../types/memory-adapter.js").MemoryContext;
  /** Forwarded `AbortSignal` so adapter recall HTTP can be cancelled mid-flight (EC-H). */
  signal?: AbortSignal;
}

/**
 * Optional result returned by `pre_user_send` handlers. The agent loop
 * concatenates `recalledContext` from all handlers and injects it as a
 * `<memory-context>...</memory-context>` block before the user prompt.
 *
 * @public
 */
export interface PreUserSendResult {
  recalledContext?: string;
}

/**
 * Context passed to `post_assistant_reply` hook handlers (ADR D145).
 * Fire-and-forget — exceptions are caught and surfaced to stderr; the
 * caller's `wait()` never blocks on this dispatch.
 *
 * @public
 */
export interface PostAssistantReplyContext {
  prompt: string;
  reply: string;
  agentId: string;
  runId: string;
  memoryContext?: import("../../types/memory-adapter.js").MemoryContext;
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
 * Memory provider factory shape (ADR D141). Returns a `MemoryAdapter`
 * (sync) or a Promise resolving to one (lazy HTTP probe / config load).
 *
 * Adapters live in `@theokit-memory-*` packages; the SDK never imports
 * them. Factory rejection is caught by the plugin manager and surfaced
 * as `ConfigurationError(code: "plugin_factory_failed")` (EC-F) — never
 * an unhandled rejection.
 *
 * @internal
 */
export type MemoryProviderFactory = (cwd: string) => MemoryAdapter | Promise<MemoryAdapter>;

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

/** SE36 — `Plugin.create` replaces `definePlugin` (ADR 0015). Const-companion (the `Plugin` type alias blocks a class of the same name); `create` is the generic `definePlugin`. @public */
export const Plugin = { create: definePlugin };
