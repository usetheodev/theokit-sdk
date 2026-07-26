/**
 * Provider registry (T3.2, ADR D107).
 *
 * `registerProvider` is idempotent and surface-warning: re-registering
 * a `name` logs to stderr (D107 last-writer-wins with WARN). Alias
 * collisions also warn (EC-5).
 *
 * @internal
 */

import { globalSingleton } from "../global-singleton.js";
import type { ProviderProfile } from "./types.js";

/**
 * M44 B1 fix — the registry state lives on `globalThis` keyed by `Symbol.for`, so EVERY bundle copy of this
 * module (tsup bundles each entry separately with `splitting: false` — `dist/index.js` and `dist/models.js`
 * each embed their own copy) shares the SAME maps. Without this, `@theokit/sdk/models`'s
 * `refreshModelCatalog` saw an eternally-empty registry and its patches were invisible to the core bundle's
 * capability/pricing lookups (state duplication made load-bearing by M44).
 */
const REGISTRY = globalSingleton(
  "theokit-sdk.providers.registry",
  () => new Map<string, ProviderProfile>(),
);
const ALIASES = globalSingleton("theokit-sdk.providers.aliases", () => new Map<string, string>());

export function registerProvider(profile: ProviderProfile): void {
  if (REGISTRY.has(profile.name)) {
    process.stderr.write(`[theokit-sdk] Provider "${profile.name}" overridden by user plugin.\n`);
  }
  REGISTRY.set(profile.name, profile);
  for (const alias of profile.aliases ?? []) {
    // EC-5: surface alias collision so operators notice mis-routing.
    const previous = ALIASES.get(alias);
    if (previous !== undefined && previous !== profile.name) {
      process.stderr.write(
        `[theokit-sdk] Alias "${alias}" collision: was "${previous}", now "${profile.name}".\n`,
      );
    }
    ALIASES.set(alias, profile.name);
  }
}

export function getProviderProfile(name: string): ProviderProfile | undefined {
  const canonical = ALIASES.get(name) ?? name;
  return REGISTRY.get(canonical);
}

export function listProviders(): ProviderProfile[] {
  return Array.from(REGISTRY.values());
}

/** Test-only reset. @internal */
export function _resetProvidersForTests(): void {
  REGISTRY.clear();
  ALIASES.clear();
}
