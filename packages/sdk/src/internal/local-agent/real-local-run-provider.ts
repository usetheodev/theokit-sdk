/**
 * Provider inference helpers for the real local run — extracted from
 * `real-local-run.ts` to keep it within the G8 LoC budget and give the
 * "which provider?" heuristics one cohesive home.
 *
 * The precedence diagnostic joined them for the same two reasons: it answers the same question
 * ("which provider, and was that what the caller asked for?"), and adding it inline pushed
 * `real-local-run.ts` to 411 LoC against the 400 budget. The gate asked for a split and this is
 * where the split already lives.
 *
 * @internal
 */

import { providerFromApiKeyPrefix } from "../auth/api-key-prefix.js";
import { diag } from "../diagnostics.js";
import { getProviderProfile } from "../providers/index.js";

/**
 * The provider a key belongs to, **restricted to providers this runtime can construct**.
 *
 * The prefix table moved to `auth/api-key-prefix.ts` and is no longer duplicated here — it was the
 * same knowledge in two places, and the copy here relied on its entries being hand-written in
 * longest-first order to be correct at all. What stays is the part that is genuinely this path's
 * policy: the local run will not name a provider it has no profile for.
 *
 * @internal
 */
export function inferProviderFromApiKey(apiKey: string | undefined): string | undefined {
  const provider = providerFromApiKeyPrefix(apiKey);
  if (provider === undefined) return undefined;
  return getProviderProfile(provider) === undefined ? undefined : provider;
}

/**
 * The default primary provider from the environment: the first of
 * ANTHROPIC / OPENAI / OPENROUTER with a non-empty key, else `openai`.
 *
 * @internal
 */
export function detectPrimaryProvider(): string {
  if (process.env.ANTHROPIC_API_KEY !== undefined && process.env.ANTHROPIC_API_KEY.length > 0) {
    return "anthropic";
  }
  if (process.env.OPENAI_API_KEY !== undefined && process.env.OPENAI_API_KEY.length > 0) {
    return "openai";
  }
  if (process.env.OPENROUTER_API_KEY !== undefined && process.env.OPENROUTER_API_KEY.length > 0) {
    return "openrouter";
  }
  return "openai";
}

/**
 * Warns once per (asked, used) pair when the resolved provider is not the one the model id named.
 *
 * One-shot per pair, mirroring `warnNoAuthApiKeysIgnoredOnce` in `router.ts` — the same "your
 * input was ignored, here is why" shape, and a per-request warning is one nobody reads.
 *
 * Silent when the model id carried no provider prefix, or when the prefix IS what was used: an
 * override that did not happen is not news.
 *
 * @internal
 */
const warnedProviderPrecedence = new Set<string>();
export function warnProviderPrecedenceOnce(asked: string | undefined, used: string): void {
  if (asked === undefined || asked === used) return;
  const key = `${asked}->${used}`;
  if (warnedProviderPrecedence.has(key)) return;
  warnedProviderPrecedence.add(key);
  diag(
    `[theokit-sdk] model id names provider "${asked}", but "${used}" was used — an explicit ` +
      "`providers.routes[0]` or the API key's own prefix outranks the model id's prefix. " +
      "Pass `providers.routes` to choose deliberately.\n",
  );
}

/** Test-only reset. @internal */
export function _resetProviderPrecedenceWarnings(): void {
  warnedProviderPrecedence.clear();
}
