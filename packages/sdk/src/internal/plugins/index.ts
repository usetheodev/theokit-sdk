/**
 * Barrel for the Plugin contract (ADRs D97-D101).
 *
 * @internal
 */

export { createPluginContext, type PluginRegistrations } from "./context.js";
export { runFireAndForgetHooks, runTransformHooks } from "./lifecycle.js";
export {
  type AggregatedPlugins,
  type MemoryEntry,
  PluginManager,
  type ProviderEntry,
} from "./manager.js";
export {
  type CommandHandler,
  type CommandOptions,
  definePlugin,
  type HookHandler,
  type HookName,
  type MemoryProviderFactory,
  Plugin,
  type PluginContext,
  type PostAssistantReplyContext,
  type PreToolCallContext,
  type PreToolCallDecision,
  type PreUserSendContext,
  type PreUserSendResult,
} from "./types.js";
