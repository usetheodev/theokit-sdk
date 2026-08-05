import { openAiCompatibleProfile } from "./openai-compatible.js";

/** M45 — xAI (Grok). Values per models.dev `xai` (2026-07 snapshot; grok-2 retired). */
export const XAI = openAiCompatibleProfile({
  name: "xai",
  aliases: ["grok"],
  baseUrl: "https://api.x.ai/v1",
  envVars: ["XAI_API_KEY"],
  fallbackModels: ["grok-4.5", "grok-4.3"],
  hostname: "api.x.ai",
});
