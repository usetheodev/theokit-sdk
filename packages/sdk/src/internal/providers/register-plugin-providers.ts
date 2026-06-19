/**
 * Bridge plugin-aggregated provider profiles into the provider registry so a
 * `kind: "model-provider"` plugin actually routes (T1 — closes the half-wired
 * path: `PluginManager` aggregated `providerProfiles` were never registered,
 * so `getProviderProfile`/`resolveProviderChain` never saw them).
 *
 * `registerProvider` is idempotent + WARN-on-override (ADR D107), so calling
 * this once per local run is safe.
 *
 * @internal
 */

import { registerProvider } from "./registry.js";
import type { ProviderProfile } from "./types.js";

/** One aggregated provider entry, as collected by `PluginManager`. */
export interface PluginProviderEntry {
  readonly pluginName: string;
  readonly profile: ProviderProfile;
}

/**
 * Register every plugin-contributed provider profile. Returns the number of
 * profiles registered (used as the runtime signal for the wiring triad).
 */
export function registerPluginProviderProfiles(
  entries: ReadonlyArray<PluginProviderEntry>,
): number {
  let registered = 0;
  for (const entry of entries) {
    registerProvider(entry.profile);
    registered += 1;
  }
  return registered;
}
