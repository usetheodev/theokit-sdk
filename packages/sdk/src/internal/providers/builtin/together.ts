import { openAiCompatibleProfile } from "./openai-compatible.js";

/** M45 — Together AI (models.dev id `togetherai` — kept as an alias). Values per the 2026-07 snapshot. */
export const TOGETHER = openAiCompatibleProfile({
  name: "together",
  aliases: ["togetherai"],
  baseUrl: "https://api.together.xyz/v1",
  envVars: ["TOGETHER_API_KEY"],
  fallbackModels: ["Qwen/Qwen2.5-7B-Instruct-Turbo"],
  hostname: "api.together.xyz",
});
