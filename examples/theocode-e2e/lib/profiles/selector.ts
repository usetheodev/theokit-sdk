import { anthropicProfile } from "./anthropic.js";
import { defaultProfile } from "./default.js";
import { geminiProfile } from "./gemini.js";
import { openaiProfile } from "./openai.js";
import type { PromptProfile } from "./types.js";

/**
 * Provider prefix patterns mapped to profiles.
 * Checked in order — first match wins.
 */
const PREFIX_MAP: ReadonlyArray<{ prefix: string; profile: PromptProfile }> = [
  { prefix: "anthropic/", profile: anthropicProfile },
  { prefix: "openai/", profile: openaiProfile },
  { prefix: "google/", profile: geminiProfile },
];

/**
 * Bare model name patterns (no provider prefix).
 * Checked when no prefix matched.
 */
const NAME_PATTERNS: ReadonlyArray<{ pattern: RegExp; profile: PromptProfile }> = [
  { pattern: /^claude-/i, profile: anthropicProfile },
  { pattern: /^gpt-/i, profile: openaiProfile },
  { pattern: /^o[134]-/i, profile: openaiProfile },
  { pattern: /^gemini-/i, profile: geminiProfile },
];

/**
 * Resolve the best prompt profile for a given model ID string.
 *
 * Handles three formats:
 *  - Full qualified: "anthropic/claude-sonnet-4-20250514"
 *  - Router-prefixed: "openrouter/anthropic/claude-sonnet-4"
 *  - Bare name: "claude-sonnet-4", "gpt-4o", "gemini-2.5-pro"
 *
 * Falls back to the default profile when no provider can be identified.
 */
export function resolveProfile(modelId: string): PromptProfile {
  // Strip common router prefixes (e.g. "openrouter/")
  let normalized = modelId;
  const routerPrefixes = ["openrouter/", "litellm/", "portkey/"];
  for (const rp of routerPrefixes) {
    if (normalized.startsWith(rp)) {
      normalized = normalized.slice(rp.length);
      break;
    }
  }

  // Check provider prefix
  for (const { prefix, profile } of PREFIX_MAP) {
    if (normalized.startsWith(prefix)) {
      return profile;
    }
  }

  // Check bare model name patterns
  for (const { pattern, profile } of NAME_PATTERNS) {
    if (pattern.test(normalized)) {
      return profile;
    }
  }

  return defaultProfile;
}
