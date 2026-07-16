/**
 * Plugin contract — RUNTIME value + type re-exports (T1.1, ADRs D97-D101).
 *
 * SE45/SE46 — the pure `Plugin` *type* and its type companions now live in
 * `types/plugin.ts` (above the DIP boundary, because `Plugin` is public
 * contract). This module keeps the RUNTIME value (`definePlugin` /
 * `Plugin.create`) and re-exports the types so every existing
 * `../plugins/types.js` importer (and the `index.ts` barrel) resolves the same
 * names unchanged.
 *
 * @public
 */

import type { Plugin as PluginType } from "../../types/plugin.js";

export type {
  CommandHandler,
  CommandOptions,
  HookHandler,
  HookName,
  LlmCallContext,
  // `MemoryProviderFactory` is @internal; re-exporting it across this module hop
  // trips rollup-plugin-dts (it strips @internal decls, then the re-export dangles
  // — see stripInternal in tsconfig.base.json). Its two internal consumers import
  // it directly from ../../types/plugin.js instead. It stays reachable as the
  // `createProvider` field type on the `Plugin` union, which IS re-exported here.
  PluginContext,
  PostAssistantReplyContext,
  PostToolCallContext,
  PreToolCallContext,
  PreToolCallDecision,
  PreUserSendContext,
  PreUserSendResult,
  SessionLifecycleContext,
  ToolContext,
  TransformContext,
} from "../../types/plugin.js";

// Re-establish the declaration merge locally: `Plugin` is BOTH the discriminated
// union *type* (aliased from ./types/plugin.js) AND the runtime const-companion
// (`Plugin.create`) declared below. Keeping both bindings under the one exported
// name `Plugin` preserves the public value+type surface byte-for-byte.
export type Plugin = PluginType;

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
