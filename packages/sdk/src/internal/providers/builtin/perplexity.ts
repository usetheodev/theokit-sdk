import { openAiCompatibleProfile } from "./openai-compatible.js";

/**
 * M45 — Perplexity. Its endpoint is UNVERSIONED (`/chat/completions`) — the explicit `chatCompletionsPath`
 * escape expresses it (the sonar-online model family was retired; models per models.dev `perplexity`).
 */
export const PERPLEXITY = openAiCompatibleProfile({
  name: "perplexity",
  baseUrl: "https://api.perplexity.ai",
  chatCompletionsPath: "/chat/completions",
  envVars: ["PERPLEXITY_API_KEY"],
  fallbackModels: ["sonar-pro", "sonar"],
  hostname: "api.perplexity.ai",
});
