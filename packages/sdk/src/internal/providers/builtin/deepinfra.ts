import { openAiCompatibleProfile } from "./openai-compatible.js";

/** M45 — DeepInfra. OpenAI-compat surface under /v1/openai (models.dev `deepinfra`). */
export const DEEPINFRA = openAiCompatibleProfile({
  name: "deepinfra",
  baseUrl: "https://api.deepinfra.com/v1/openai",
  envVars: ["DEEPINFRA_API_KEY"],
  fallbackModels: ["Qwen/Qwen3-32B"],
  hostname: "api.deepinfra.com",
});
