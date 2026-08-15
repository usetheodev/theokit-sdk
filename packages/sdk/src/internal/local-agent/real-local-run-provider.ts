/**
 * Provider inference helpers for the real local run — extracted from
 * `real-local-run.ts` to keep it within the G8 LoC budget and give the two
 * pure "which provider?" heuristics one cohesive home.
 *
 * @internal
 */

import { providerFromApiKeyPrefix } from "../auth/api-key-prefix.js";
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
