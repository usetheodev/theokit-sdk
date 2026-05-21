import type { ProviderProfile } from "../types.js";

/**
 * LM Studio provider profile (T7.1, ADR D188).
 *
 * LM Studio exposes an OpenAI-compatible `/v1/chat/completions` endpoint
 * on `http://localhost:1234` by default (configurable via the LM Studio
 * UI under "Local Server"). Inherits the `authType: "none"` primitive
 * from D182 — no API key required for local use.
 *
 * LM Studio idiosyncrasies:
 *  - Loads ONE model at a time via the desktop UI. The `model` field in
 *    the chat-completions request is informational only — LM Studio
 *    serves whatever model is currently loaded.
 *  - `/v1/models` returns a single entry pointing to the loaded model.
 *  - Tool calling depends on the underlying model.
 *
 * Override the default URL with `LMSTUDIO_HOST` (mirrors `OLLAMA_HOST`).
 *
 * @internal
 */
export const LMSTUDIO: ProviderProfile = {
  name: "lmstudio",
  aliases: ["lm-studio", "lm_studio"],
  apiMode: "chat_completions",
  envVars: ["LMSTUDIO_API_KEY"],
  authType: "none",
  baseUrl: "http://localhost:1234",
  modelsUrl: "http://localhost:1234/v1/models",
  hostname: "localhost",
  fallbackModels: ["loaded-model"],
};
