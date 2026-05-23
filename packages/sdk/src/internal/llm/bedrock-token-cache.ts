/**
 * Bedrock Bearer token resolution + cache (ADRs D287, D295).
 *
 * Two paths:
 *   1. Explicit env (`AWS_BEARER_TOKEN_BEDROCK`) wins; no refresh.
 *   2. Optional peer dep `@aws/bedrock-token-generator` (D287) auto-refreshes
 *      short-term tokens. Cached for 1.5h (75% of the generator's 2h max).
 *
 * `resolveBedrockToken` returns `undefined` only when BOTH paths produce no
 * token. Caller (router) is responsible for throwing a helpful error
 * (D279/EC-6) — this module is auth-resolution only.
 *
 * @internal
 */

import { createRequire } from "node:module";

interface CachedToken {
  value: string;
  expiresAt: number;
}

let cachedToken: CachedToken | null = null;

interface BedrockTokenGenerator {
  provideBedrockToken: (opts: { region: string }) => Promise<string>;
}

const CACHE_TTL_MS = 90 * 60 * 1000; // 1.5h

export async function resolveBedrockToken(region: string): Promise<string | undefined> {
  // Path 1: explicit env wins.
  const env = process.env.AWS_BEARER_TOKEN_BEDROCK;
  if (env !== undefined && env.length > 0) return env;

  // Path 2: cached generator token (if peer dep installed).
  const now = Date.now();
  if (cachedToken !== null && cachedToken.expiresAt > now) {
    return cachedToken.value;
  }

  try {
    const r = createRequire(import.meta.url);
    const mod = r("@aws/bedrock-token-generator") as BedrockTokenGenerator;
    if (typeof mod.provideBedrockToken !== "function") return undefined;
    const token = await mod.provideBedrockToken({ region });
    cachedToken = { value: token, expiresAt: now + CACHE_TTL_MS };
    return token;
  } catch {
    // Peer dep missing OR generator threw (no AWS creds available).
    // Caller handles `undefined` with a helpful ConfigurationError.
    return undefined;
  }
}

/** Test seam — clear cache between tests. */
export function __resetBedrockTokenCache(): void {
  cachedToken = null;
}
