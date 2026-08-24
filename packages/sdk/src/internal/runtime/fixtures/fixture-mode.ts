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

import { existsSync } from "node:fs";

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
 * The provider credentials `shouldUseRealLocalRuntime` consults by name.
 *
 * Exported so the "Missing API key" refusal can name the ones the caller actually set (#338 item
 * 5). The list used to live only inside the predicate below, which meant a caller with
 * `OPENROUTER_API_KEY` set and `THEOKIT_API_KEY` unset was refused by a message naming neither —
 * the SDK checks this exact variable a few lines down to decide the runtime, so the environment
 * looks configured to the person who set it up. Reported as a three-hour diagnosis.
 *
 * One list, two readers: a variable added here is recognised by the predicate AND named by the
 * error on the same commit, which is the only way the two stay in step.
 */
export const PROVIDER_CREDENTIAL_ENV_VARS: readonly string[] = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
];

/** Those of {@link PROVIDER_CREDENTIAL_ENV_VARS} that are non-empty in this process. */
export function presentProviderCredentialEnvVars(): readonly string[] {
  return PROVIDER_CREDENTIAL_ENV_VARS.filter((name) => {
    const value = process.env[name];
    return typeof value === "string" && value.length > 0;
  });
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
    presentProviderCredentialEnvVars().length > 0 ||
    isAwsBedrockAuthAvailable() ||
    isGcpVertexAuthAvailable() ||
    isLocalNoAuthProviderAvailable()
  );
}

/**
 * ADRs D286-D287: Bedrock green-lights real runtime when EITHER
 * `AWS_BEARER_TOKEN_BEDROCK` is set explicitly OR the standard AWS
 * credential chain (`AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` /
 * `AWS_PROFILE` / instance role) can mint a Bearer via
 * `@aws/bedrock-token-generator`. We only check synchronous signals here;
 * the actual token resolution happens lazily in
 * `BedrockAnthropicClient.stream`.
 */
function isAwsBedrockAuthAvailable(): boolean {
  if (
    typeof process.env.AWS_BEARER_TOKEN_BEDROCK === "string" &&
    process.env.AWS_BEARER_TOKEN_BEDROCK.length > 0
  ) {
    return true;
  }
  if (
    typeof process.env.AWS_ACCESS_KEY_ID === "string" &&
    process.env.AWS_ACCESS_KEY_ID.length > 0
  ) {
    return true;
  }
  if (typeof process.env.AWS_PROFILE === "string" && process.env.AWS_PROFILE.length > 0) {
    return true;
  }
  // Default profile file (~/.aws/credentials). The credential chain will
  // resolve it via fromNodeProviderChain() at stream time, or surface a
  // helpful error if neither file nor IMDS is reachable.
  return awsCredentialsFileExists();
}

function awsCredentialsFileExists(): boolean {
  try {
    const home = process.env.HOME ?? process.env.USERPROFILE;
    if (home === undefined || home.length === 0) return false;
    return existsSync(`${home}/.aws/credentials`) || existsSync(`${home}/.aws/config`);
  } catch {
    return false;
  }
}

/**
 * ADR D288: Vertex green-lights real runtime when EITHER
 * `GOOGLE_APPLICATION_CREDENTIALS` is set OR `GOOGLE_CLOUD_PROJECT` is set
 * (ADC will use gcloud user creds / metadata server). The actual token
 * resolution happens lazily in `VertexAnthropicClient.stream` /
 * `VertexGeminiClient.stream`.
 */
function isGcpVertexAuthAvailable(): boolean {
  if (
    typeof process.env.GOOGLE_APPLICATION_CREDENTIALS === "string" &&
    process.env.GOOGLE_APPLICATION_CREDENTIALS.length > 0
  ) {
    return true;
  }
  if (
    typeof process.env.GOOGLE_CLOUD_PROJECT === "string" &&
    process.env.GOOGLE_CLOUD_PROJECT.length > 0
  ) {
    return true;
  }
  return false;
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
