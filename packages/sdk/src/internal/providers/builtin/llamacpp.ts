import type { ProviderProfile } from "../types.js";

/**
 * llama.cpp server provider profile (T7.2, ADR D189).
 *
 * llama.cpp ships a HTTP server binary (`./server` since b1500+) that
 * implements the OpenAI-compatible `/v1/chat/completions` endpoint on
 * `http://localhost:8080` by default. Inherits `authType: "none"` from
 * D182 — no API key required for local use.
 *
 * llama.cpp idiosyncrasies:
 *  - Server loads a single GGUF model at startup via `--model` CLI
 *    flag. The `model` field in the chat-completions request is
 *    cosmetic — any string works; the response comes from the loaded
 *    model regardless. This is documented in
 *    `.claude/knowledge-base/reviews/edge-case/ollama-integration-edge-cases-2026-05-21.md`
 *    as EC-O.
 *  - Tool calling support depends entirely on the underlying model.
 *
 * Override the default URL with `LLAMACPP_HOST`.
 *
 * @internal
 */
export const LLAMACPP: ProviderProfile = {
  name: "llamacpp",
  aliases: ["llama-cpp", "llama.cpp"],
  apiMode: "chat_completions",
  envVars: ["LLAMACPP_API_KEY"],
  authType: "none",
  baseUrl: "http://localhost:8080",
  modelsUrl: "http://localhost:8080/v1/models",
  hostname: "localhost",
  fallbackModels: ["loaded-model"],
};
