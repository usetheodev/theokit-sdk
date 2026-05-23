/**
 * Bedrock Bearer token resolution + cache (ADRs D287, D295).
 *
 * Two paths:
 *   1. Explicit env (`AWS_BEARER_TOKEN_BEDROCK`) wins; no refresh.
 *   2. Optional peer dep `@aws/bedrock-token-generator` (D287) auto-generates
 *      short-term tokens from the standard AWS credential chain
 *      (`@aws-sdk/credential-providers`). Cached for 1.5h.
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

interface BedrockTokenGeneratorApi {
  getToken: (opts: { credentials: unknown; region: string }) => Promise<string>;
}

interface CredentialProvidersApi {
  fromNodeProviderChain: () => () => Promise<unknown>;
}

const CACHE_TTL_MS = 90 * 60 * 1000; // 1.5h

export async function resolveBedrockToken(region: string): Promise<string | undefined> {
  const env = process.env.AWS_BEARER_TOKEN_BEDROCK;
  if (env !== undefined && env.length > 0) return env;

  const now = Date.now();
  if (cachedToken !== null && cachedToken.expiresAt > now) {
    return cachedToken.value;
  }

  try {
    const r = createRequire(import.meta.url);
    const gen = r("@aws/bedrock-token-generator") as BedrockTokenGeneratorApi;
    if (typeof gen.getToken !== "function") return undefined;

    const providers = r("@aws-sdk/credential-providers") as CredentialProvidersApi;
    if (typeof providers.fromNodeProviderChain !== "function") return undefined;

    const credentialProvider = providers.fromNodeProviderChain();
    const token = await gen.getToken({ credentials: credentialProvider, region });
    cachedToken = { value: token, expiresAt: now + CACHE_TTL_MS };
    return token;
  } catch {
    return undefined;
  }
}

/** Test seam — clear cache between tests. */
export function __resetBedrockTokenCache(): void {
  cachedToken = null;
}
