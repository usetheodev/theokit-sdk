import type { ProviderProfile } from "../types.js";

export const ANTHROPIC: ProviderProfile = {
  name: "anthropic",
  apiMode: "anthropic_messages",
  envVars: ["ANTHROPIC_API_KEY"],
  authType: "api_key",
  baseUrl: "https://api.anthropic.com",
  modelsUrl: "https://api.anthropic.com/v1/models",
  hostname: "api.anthropic.com",
  fallbackModels: ["claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
};
