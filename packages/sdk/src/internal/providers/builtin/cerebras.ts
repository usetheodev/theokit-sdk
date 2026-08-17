import { openAiCompatibleProfile } from "./openai-compatible.js";

/**
 * M45 — Cerebras. The integration header value is theokit's own: the header attributes TRAFFIC.
 * Models per models.dev (2026-07 snapshot).
 */
export const CEREBRAS = openAiCompatibleProfile({
  name: "cerebras",
  baseUrl: "https://api.cerebras.ai/v1",
  envVars: ["CEREBRAS_API_KEY"],
  fallbackModels: ["gpt-oss-120b", "zai-glm-4.7"],
  extraHeaders: { "X-Cerebras-3rd-Party-Integration": "theokit" },
  hostname: "api.cerebras.ai",
});
