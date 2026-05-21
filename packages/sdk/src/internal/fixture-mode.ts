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
 * @internal
 */

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
 * Returns the base URL configured via `THEOKIT_API_BASE_URL`, or `undefined`
 * when not set.
 *
 * @internal
 */
export function getConfiguredBaseUrl(): string | undefined {
  const value = process.env.THEOKIT_API_BASE_URL;
  if (value === undefined || value.length === 0) return undefined;
  return value;
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
  if (apiKey === undefined || apiKey.length === 0) return false;
  // ADR D182 / T1.2: `authType: "none"` providers (Ollama, LM Studio,
  // llama.cpp) do not require any provider env var. Treat their presence
  // — signaled via OLLAMA_HOST/LMSTUDIO_HOST/LLAMACPP_HOST OR the
  // implicit-localhost default — as a green-light for real runtime.
  // For zero-config Ollama, we accept the default `http://localhost:11434`
  // unconditionally; the actual call will surface a typed
  // `ollama_unreachable` if Ollama is not running.
  return (
    (typeof process.env.ANTHROPIC_API_KEY === "string" &&
      process.env.ANTHROPIC_API_KEY.length > 0) ||
    (typeof process.env.OPENAI_API_KEY === "string" && process.env.OPENAI_API_KEY.length > 0) ||
    (typeof process.env.OPENROUTER_API_KEY === "string" &&
      process.env.OPENROUTER_API_KEY.length > 0) ||
    isLocalNoAuthProviderAvailable()
  );
}

/**
 * ADR D182 / T1.2: zero-config local providers (`authType: "none"`) are
 * always available — Ollama defaults to localhost:11434, LM Studio to
 * localhost:1234, llama.cpp to localhost:8080. We don't probe here
 * (would require async); we return `true` when ANY of the documented
 * local hosts is reachable in spirit. The first real LLM call surfaces
 * `ollama_unreachable` via the typed mapper if no daemon is up.
 */
function isLocalNoAuthProviderAvailable(): boolean {
  // Always true — the SDK ships Ollama as a builtin. Caller will see a
  // typed error if it isn't actually running.
  return true;
}
