/**
 * Minimal ACP server entry point. Default-exports a factory: ACP host
 * spawns one process per session and calls `factory(sessionId)` to get a
 * fresh `SDKAgent` for each session (D351 — per-session isolation).
 *
 * Wired with OPENROUTER_API_KEY → gpt-4o-mini. Override via env to taste.
 */

import { Agent, type SDKAgent } from "@usetheo/sdk";

export default async function createAgentForSession(sessionId: string): Promise<SDKAgent> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (apiKey === undefined || apiKey.length === 0) {
    throw new Error(
      "OPENROUTER_API_KEY not set — required to run the ACP example. " +
        "Set it in your environment or .env before running theokit-acp.",
    );
  }
  return Agent.create({
    apiKey,
    model: { id: process.env.ACP_EXAMPLE_MODEL ?? "openai/gpt-4o-mini" },
    local: { cwd: process.cwd() },
    name: `acp-${sessionId}`,
  });
}
