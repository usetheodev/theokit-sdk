import type { ProviderProfile } from "../types.js";

export const OPENROUTER: ProviderProfile = {
  name: "openrouter",
  apiMode: "chat_completions",
  aliases: ["or"],
  // Ordered fallback (EC-10): OPENROUTER_API_KEY preferred, OPENAI_API_KEY as compat.
  envVars: ["OPENROUTER_API_KEY", "OPENAI_API_KEY"],
  authType: "api_key",
  baseUrl: "https://openrouter.ai/api",
  modelsUrl: "https://openrouter.ai/api/v1/models",
  hostname: "openrouter.ai",
  fallbackModels: ["openai/gpt-4o-mini", "anthropic/claude-3-haiku"],
};
