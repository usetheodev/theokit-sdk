// SERVER-ONLY MODULE. Do NOT import from "use client" components.
// This file accesses `process.env` and the full SDK runtime. Importing
// from a client component will fail Next.js build (the bundler refuses
// to include server-only code in the browser).

import { Agent, type SDKAgent } from "@usetheo/sdk";

let cachedAgent: SDKAgent | undefined;

/**
 * Lazily create (or resume) a singleton agent per route handler process.
 *
 * On Vercel / AWS Lambda serverless: this cache resets on EACH cold start.
 * Correctness is preserved via `Agent.getOrCreate` which dedupes by
 * `agentId` against the persisted registry on disk (ADR D22).
 *
 * In `next dev` (long-lived process), the cache survives HMR reloads.
 */
export async function getAgent(agentId: string): Promise<SDKAgent> {
  if (cachedAgent !== undefined) return cachedAgent;
  const apiKey =
    process.env.THEOKIT_API_KEY ??
    process.env.OPENROUTER_API_KEY ??
    process.env.ANTHROPIC_API_KEY ??
    process.env.OPENAI_API_KEY;
  if (apiKey === undefined) {
    throw new Error(
      "No provider API key in env. Set OPENROUTER_API_KEY (or ANTHROPIC_API_KEY / OPENAI_API_KEY) in .env.local.",
    );
  }
  cachedAgent = await Agent.getOrCreate(agentId, {
    apiKey,
    model: { id: "google/gemini-2.0-flash-001" },
    local: { cwd: process.cwd(), sandboxOptions: { enabled: false } },
  });
  return cachedAgent;
}
