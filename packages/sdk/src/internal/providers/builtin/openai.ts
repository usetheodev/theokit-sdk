import type { ProviderProfile } from "../types.js";

export const OPENAI: ProviderProfile = {
  name: "openai",
  apiMode: "chat_completions",
  envVars: ["OPENAI_API_KEY"],
  authType: "api_key",
  baseUrl: "https://api.openai.com",
  modelsUrl: "https://api.openai.com/v1/models",
  hostname: "api.openai.com",
  fallbackModels: ["gpt-4o", "gpt-4o-mini"],
};
