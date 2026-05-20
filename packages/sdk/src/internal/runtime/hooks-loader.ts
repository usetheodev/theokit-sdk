/**
 * Boot-time hooks validation. Confirms `.theokit/hooks/` (preferred) or
 * `.theokit/hooks.json` (deprecated) is parseable when
 * `local.settingSources` includes `"project"`. Delegates the actual load
 * (including the MD-first fallback chain, ADR D77) to `hooks-source.ts`.
 *
 * Malformed config raises `ConfigurationError` loudly — never silently
 * ignored.
 *
 * @internal
 */

import { loadHookConfig } from "./hooks-source.js";

export async function loadProjectHooks(
  cwd: string,
  settingSourcesIncludeProject: boolean,
): Promise<void> {
  if (!settingSourcesIncludeProject) return;
  // Load + validate. Throws ConfigurationError on parse / schema failure.
  // Return value discarded — this function is boot-time validation only;
  // the executor re-loads at runtime to get the actual config it'll use.
  await loadHookConfig(cwd);
}
