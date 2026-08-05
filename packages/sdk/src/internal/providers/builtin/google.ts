import { openAiCompatibleProfile } from "./openai-compatible.js";

/**
 * M45 — Google Gemini via the DIRECT OpenAI-compat endpoint (a Google API key, not OpenRouter). Distinct
 * from the `gemini` builtin (an OpenRouter passthrough) by ADR D3 — two routes, two names. Endpoint + env
 * vars per Google's OpenAI-compatibility docs (mirrored by models.dev `google` + the M44 catalog entry).
 */
export const GOOGLE = openAiCompatibleProfile({
  name: "google",
  baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
  envVars: ["GOOGLE_API_KEY", "GEMINI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"],
  fallbackModels: ["gemini-2.5-pro", "gemini-2.5-flash"],
  hostname: "generativelanguage.googleapis.com",
});
