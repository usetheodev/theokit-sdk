/**
 * Minimal ACP server entry point. Default-exports a factory: ACP host
 * spawns one process per session and calls `factory(sessionId)` to get a
 * fresh `SDKAgent` for each session (D351 — per-session isolation).
 *
 * Provider precedence:
 *   1. `OPENROUTER_API_KEY` → openrouter/<model> (default `openai/gpt-4o-mini`)
 *   2. else falls through to Ollama at `OLLAMA_HOST` (default `localhost:11434`)
 *      with `ACP_OLLAMA_MODEL` (default `qwen2.5:3b`)
 *
 * Override either via env: `ACP_EXAMPLE_MODEL`, `ACP_OLLAMA_MODEL`, `OLLAMA_HOST`.
 */

import { Agent, type SDKAgent } from "@theokit/sdk";

export default async function createAgentForSession(sessionId: string): Promise<SDKAgent> {
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  if (typeof openrouterKey === "string" && openrouterKey.length > 0) {
    return Agent.create({
      apiKey: openrouterKey,
      model: { id: process.env.ACP_EXAMPLE_MODEL ?? "openai/gpt-4o-mini" },
      providers: {
        routes: [{ capability: "chat", provider: "openrouter" }],
        fallback: ["openrouter"],
      },
      local: { cwd: process.cwd() },
      name: `acp-${sessionId}`,
    });
  }

  // Ollama fallback — 100% local, no remote provider needed.
  const ollamaModel = process.env.ACP_OLLAMA_MODEL ?? "qwen2.5:3b";
  return Agent.create({
    apiKey: "local",
    model: { id: `ollama/${ollamaModel}` },
    local: { cwd: process.cwd() },
    name: `acp-${sessionId}`,
  });
}
