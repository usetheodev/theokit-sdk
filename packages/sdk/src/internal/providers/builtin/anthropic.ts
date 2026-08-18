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
  // M45 — the Anthropic beta-features header (interleaved thinking + fine-grained tool streaming). An
  // Anthropic API constant. The
  // SANCTIONED behavior delta of M45 (ADR D4) — consumed by the anthropic transport's extraHeaders wiring.
  extraHeaders: {
    "anthropic-beta": "interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14",
  },
};
