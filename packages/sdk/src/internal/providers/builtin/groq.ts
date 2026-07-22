import { openAiCompatibleProfile } from "./openai-compatible.js";

/** M45 — Groq. Values per models.dev `groq` (2026-07 snapshot); OpenAI-compat surface under /openai/v1. */
export const GROQ = openAiCompatibleProfile({
  name: "groq",
  baseUrl: "https://api.groq.com/openai/v1",
  envVars: ["GROQ_API_KEY"],
  fallbackModels: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
  hostname: "api.groq.com",
});
