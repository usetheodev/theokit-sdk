/**
 * Provider inference helpers for the real local run — extracted from
 * `real-local-run.ts` to keep it within the G8 LoC budget and give the two
 * pure "which provider?" heuristics one cohesive home.
 *
 * @internal
 */

import { getProviderProfile } from "../providers/index.js";

/**
 * Infer the provider from an API-key prefix (`sk-or-` → openrouter, `sk-ant-` →
 * anthropic, `sk-` → openai), but only when that provider has a registered
 * profile. Returns `undefined` when no prefix matches a known provider.
 *
 * @internal
 */
export function inferProviderFromApiKey(apiKey: string | undefined): string | undefined {
  if (apiKey === undefined || apiKey.length === 0) return undefined;
  const byPrefix: ReadonlyArray<{ provider: string; prefix: string }> = [
    { provider: "openrouter", prefix: "sk-or-" },
    { provider: "anthropic", prefix: "sk-ant-" },
    { provider: "openai", prefix: "sk-" },
  ];
  for (const { provider, prefix } of byPrefix) {
    if (apiKey.startsWith(prefix) && getProviderProfile(provider) !== undefined) {
      return provider;
    }
  }
  return undefined;
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
