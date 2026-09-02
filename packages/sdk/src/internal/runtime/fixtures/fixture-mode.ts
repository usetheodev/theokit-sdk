/**
 * Fixture-mode detection.
 *
 * When `THEOKIT_API_BASE_URL` is NOT set and the API key matches the
 * `theo_test_*` pattern, the SDK runs in fixture mode — it returns
 * deterministic, baked-in responses that match the golden fixtures under
 * `tests/golden/`. This is documented behavior and part of the contract
 * (analogous to Stripe's test keys), NOT a test-side mock.
 *
 * When `THEOKIT_API_BASE_URL` is set (e.g. pointing at a test HTTP server
 * or a real Theo PaaS instance), the SDK always performs real HTTP
 * requests — fixture mode is short-circuited.
 *
 *
 * WHAT THIS FILE NO LONGER ANSWERS. It used to answer three unrelated questions in 229 lines: this
 * one, "what base URL is configured" (now `internal/base-url.ts`, whose real consumer is the
 * production HTTP module) and "does this process hold a real provider credential" (now
 * `internal/auth/credential-availability.ts`, where its dependency already pointed).
 * `shouldUseRealLocalRuntime` stays here because it COMPOSES the three — it is the decision, not the
 * policy.
 *
 * @internal
 */

import {
  isAwsBedrockAuthAvailable,
  isGcpVertexAuthAvailable,
  isLocalNoAuthProviderAvailable,
  isStoredOAuthAvailable,
  presentProviderCredentialEnvVars,
} from "../../auth/credential-availability.js";
import { getConfiguredBaseUrl } from "../../base-url.js";

const FIXTURE_API_KEY_PREFIX = "theo_test_";

/**
 * Returns `true` when the given API key is a fixture-mode key.
 *
 * @internal
 */
export function isFixtureApiKey(apiKey: string | undefined): boolean {
  if (apiKey === undefined) return false;
  return apiKey.startsWith(FIXTURE_API_KEY_PREFIX);
}

/**
 * Returns `true` when the SDK should respond from baked-in fixture data
 * instead of performing a real HTTP request.
 *
 * Rule: fixture mode is on iff (no explicit base URL configured) AND
 * (API key matches the fixture-key pattern).
 *
 * @internal
 */
export function shouldUseFixtureMode(apiKey: string | undefined): boolean {
  if (getConfiguredBaseUrl() !== undefined) return false;
  return isFixtureApiKey(apiKey);
}

/**
 * Returns `true` when the local runtime should drive the real LLM agent
 * loop instead of the deterministic fixture responder. Real mode requires
 * a non-fixture API key AND at least one provider env credential.
 *
 * @internal
 */
export function shouldUseRealLocalRuntime(apiKey: string | undefined): boolean {
  if (isFixtureApiKey(apiKey)) return false;
  // #445: an OAuth provider holds NO apiKey and sets NO env var — the credential lives on disk,
  // which is the whole point of `/login`. Both gates below reject it by construction, so a
  // logged-in `openai-chatgpt` consumer silently got the fixture responder and a plausible
  // answer with no error. This check runs FIRST, because the apiKey gate is what rejects it.
  if (isStoredOAuthAvailable()) return true;
  if (apiKey === undefined || apiKey.length === 0) return false;
  // ADR D182 / T1.2: `authType: "none"` providers (Ollama, LM Studio,
  // llama.cpp) do not require any provider env var. Treat their presence
  // — signaled via OLLAMA_HOST/LMSTUDIO_HOST/LLAMACPP_HOST OR the
  // implicit-localhost default — as a green-light for real runtime.
  // For zero-config Ollama, we accept the default `http://localhost:11434`
  // unconditionally; the actual call will surface a typed
  // `ollama_unreachable` if Ollama is not running.
  // READ THIS BEFORE AUDITING THE CHAIN: the last term is unconditionally `true`, so this whole
  // expression is `true` for any non-fixture, non-empty key. The three terms above it cannot change
  // the outcome — they are documentation of which credentials the SDK recognises, not a decision.
  // `presentProviderCredentialEnvVars` is separately exported and IS load-bearing: the "Missing API
  // key" refusal names what the caller actually set (#338 item 5).
  //
  // The terms are kept rather than collapsed to `return true` because the day the builtin-Ollama
  // assumption is revisited, this is the list to re-activate — and because two tests and
  // `internal/agent/helpers.ts:130` already document the chain in this shape. What is not kept is
  // the impression that it discriminates.
  return (
    presentProviderCredentialEnvVars().length > 0 ||
    isAwsBedrockAuthAvailable() ||
    isGcpVertexAuthAvailable() ||
    isLocalNoAuthProviderAvailable()
  );
}
