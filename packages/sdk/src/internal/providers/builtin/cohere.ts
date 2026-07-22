import { openAiCompatibleProfile } from "./openai-compatible.js";

/**
 * M45 — Cohere via its OpenAI-compatibility surface (`api.cohere.ai/compatibility/v1` — the native v2 API
 * is NOT chat_completions; the discovery flagged the old catalog baseUrl as doubly wrong). Models per
 * models.dev `cohere` (2026-07 snapshot).
 */
export const COHERE = openAiCompatibleProfile({
  name: "cohere",
  baseUrl: "https://api.cohere.ai/compatibility/v1",
  envVars: ["COHERE_API_KEY", "CO_API_KEY"],
  fallbackModels: ["command-a-03-2025"],
  hostname: "api.cohere.ai",
});
