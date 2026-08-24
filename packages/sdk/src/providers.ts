/**
 * The provider registry, as public API.
 *
 * It was `@internal`, which meant the SDK was the only thing that could answer "which providers
 * exist, and what does each one need?". `theokit` consequently kept a hand-written list of three —
 * against the 46 registered here — so an agent declaring `ollama/qwen2.5:3b` routed to whatever
 * key happened to be set instead of to Ollama (usetheokit/theokit#326).
 *
 * A second table that nothing forces to agree with the first is not a cache, it is a future bug.
 * These two functions exist so there is one table.
 *
 * Both ensure the builtins are registered before answering: registration is lazy (it happens when
 * an agent is created, a run is routed, or a provider is defined), so a caller asking early would
 * otherwise get an empty registry and reasonably conclude the SDK knows nothing.
 */

import { registerBuiltins } from "./internal/providers/builtin/index.js";
import {
  getProviderProfile as getProfile,
  listProviders as listProfiles,
} from "./internal/providers/registry.js";
import type { ProviderProfile } from "./internal/providers/types.js";

/**
 * Every registered provider — builtins, the JSON catalog, and anything a plugin registered.
 *
 * @public
 */
export function listProviders(): readonly ProviderProfile[] {
  registerBuiltins();
  return listProfiles();
}

/**
 * One provider by name or alias (`lm-studio` resolves to `lmstudio`), or `undefined` when nothing
 * has registered it.
 *
 * @public
 */
export function getProviderProfile(name: string): ProviderProfile | undefined {
  registerBuiltins();
  return getProfile(name);
}
