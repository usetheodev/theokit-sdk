import { openAiCompatibleProfile } from "./openai-compatible.js";

/** M45 — Mistral (La Plateforme). Values per models.dev `mistral` (2026-07 snapshot). */
export const MISTRAL = openAiCompatibleProfile({
  name: "mistral",
  baseUrl: "https://api.mistral.ai/v1",
  envVars: ["MISTRAL_API_KEY"],
  fallbackModels: ["mistral-large-latest", "codestral-latest"],
  hostname: "api.mistral.ai",
});
