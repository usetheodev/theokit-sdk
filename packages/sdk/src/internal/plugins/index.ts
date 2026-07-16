/**
 * Barrel for the Plugin contract (ADRs D97-D101).
 *
 * @internal
 */

// SE45/SE46 — `MemoryProviderFactory` (@internal) is sourced from the contract
// module directly; the `./types.js` shim omits it (a stripped-internal re-export
// trips rollup-plugin-dts). See ./types.ts.
export type { MemoryProviderFactory } from "../../types/plugin.js";
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
  Plugin,
  type PluginContext,
  type PostAssistantReplyContext,
  type PreToolCallContext,
  type PreToolCallDecision,
  type PreUserSendContext,
  type PreUserSendResult,
} from "./types.js";
