import type { ProviderProfile } from "../types.js";

/**
 * Ollama — local-first LLM runtime (ADR D182).
 *
 * Ships as a builtin so `Agent.create({ model: "ollama/llama3.2" })` works
 * with zero configuration when `ollama serve` is running on the default
 * port. `authType: "none"` signals the router to skip env-key resolution
 * and use a placeholder credential (Ollama ignores Authorization headers
 * on local installs).
 *
 * Overrides:
 * - `OLLAMA_HOST` — replaces the default `http://localhost:11434` baseUrl
 *   (advanced users running Ollama on a remote machine).
 * - `OLLAMA_API_KEY` — replaces the placeholder when Ollama is behind a
 *   reverse-proxy with auth or when using Ollama Cloud (paid tier).
 */
export const OLLAMA: ProviderProfile = {
  name: "ollama",
  apiMode: "chat_completions",
  envVars: ["OLLAMA_API_KEY"],
  authType: "none",
  baseUrl: "http://localhost:11434",
  modelsUrl: "http://localhost:11434/v1/models",
  hostname: "localhost",
  fallbackModels: ["llama3.2", "qwen2.5", "mistral"],
};
