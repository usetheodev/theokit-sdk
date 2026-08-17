import type { ProviderProfile } from "../types.js";

/**
 * M45 — the data-only base for OpenAI-compatible chat_completions providers. A profile-map pattern
 * flattened to
 * theokit's data model: leaves declare name/baseUrl/envVars (+ overrides) in ~10 lines; the router's
 * URL-join rule (version-segment detection + `chatCompletionsPath` escape) derives the endpoint.
 *
 * @internal
 */
export function openAiCompatibleProfile(
  p: { name: string; baseUrl: string; envVars: readonly string[] } & Partial<ProviderProfile>,
): ProviderProfile {
  return {
    apiMode: "chat_completions",
    authType: "api_key",
    fallbackModels: [],
    ...p,
  };
}
