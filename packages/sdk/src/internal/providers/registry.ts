/**
 * Provider registry (T3.2, ADR D107).
 *
 * `registerProvider` is idempotent and surface-warning: re-registering
 * a `name` logs to stderr (D107 last-writer-wins with WARN). Alias
 * collisions also warn (EC-5).
 *
 * @internal
 */

import type { ProviderProfile } from "./types.js";

const REGISTRY = new Map<string, ProviderProfile>();
const ALIASES = new Map<string, string>();

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
