import type { ProviderProfile } from "../types.js";

/**
 * Gemini via OpenRouter passthrough. Direct Gemini API uses a different
 * dialect (`generateContent`); SDK currently routes through OpenRouter's
 * OpenAI-compatible endpoint so the chat_completions transport works.
 *
 * A future plugin `@theokit-provider-gemini-direct` can override this with
 * `apiMode: "gemini_generate_content"` once that transport ships.
 */
export const GEMINI: ProviderProfile = {
  name: "gemini",
  apiMode: "chat_completions",
  envVars: ["OPENROUTER_API_KEY"],
  authType: "api_key",
  baseUrl: "https://openrouter.ai/api",
  hostname: "openrouter.ai",
  fallbackModels: ["google/gemini-2.0-flash-001"],
};
