/**
 * "Does this process hold a REAL provider credential?" — one question, one home.
 *
 * It used to live in `runtime/fixtures/fixture-mode.ts`, a 229-line module answering three unrelated
 * questions. This one spans AWS Bedrock (env var, access key, profile, `~/.aws/credentials` on
 * disk), GCP Vertex (ADC), a stored OAuth credential read off disk, and three named provider env
 * vars — a credential policy, filed under a name about test fixtures. Its dependency already pointed
 * here: `internal/auth/credential-store.js`.
 *
 * Every predicate is SYNCHRONOUS and checks a signal, never a live endpoint. Probing would be async
 * and would make a decision that belongs at request time — an unreachable Ollama or an expired token
 * must surface as a typed error from the call, not as a silent fall-through to fixture data.
 *
 * @internal
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { readStoredOAuth } from "./credential-store.js";
import type { CredentialStoreConfig } from "./types.js";

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
 * The SDK's ambient credential store, mirroring the one `openai-chatgpt` reads. Kept in sync with
 * `providers/builtin/openai-chatgpt.ts`; `THEOKIT_AUTH_HOME` (not `THEOKIT_HOME`) is the override.
 */
const AMBIENT_STORE: CredentialStoreConfig = {
  home: homedir(),
  dirName: ".theokit",
  fileName: "auth.json",
  homeEnvVar: "THEOKIT_AUTH_HOME",
};

/**
 * #445 — a stored OAuth credential green-lights the real runtime, the same way Bedrock and Vertex
 * do for their own non-env auth. Without it, `authType: "oauth_device_code"` providers fall through
 * to the fixture responder after a SUCCESSFUL login: the docblock's rule ("a non-fixture API key AND
 * at least one provider env credential") predates OAuth providers and was never revisited when
 * `openai-chatgpt` landed.
 *
 * Reads only — never refreshes, never writes. Presence is the signal; validity is the transform's
 * problem at request time, and an expired credential must surface as an auth error rather than as
 * a fixture answer that looks like success.
 *
 * @internal
 */
export function isStoredOAuthAvailable(
  env: Record<string, string | undefined> = process.env,
): boolean {
  try {
    return readStoredOAuth(AMBIENT_STORE, env) !== undefined;
  } catch {
    // An unreadable or malformed store is not a green light, but it is also not a crash:
    // the caller falls through to the env-var path and the failure surfaces there.
    return false;
  }
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
export function isAwsBedrockAuthAvailable(): boolean {
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
export function isGcpVertexAuthAvailable(): boolean {
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
 * ADR D182 / T1.2: **always `true`.** Zero-config local providers (`authType: "none"`) need no
 * credential — Ollama defaults to localhost:11434, LM Studio to localhost:1234, llama.cpp to
 * localhost:8080 — and the SDK ships Ollama as a builtin, so one is always nominally available.
 * Nothing is probed here; probing would be async. If no daemon is up, the first real LLM call
 * surfaces `ollama_unreachable` via the typed mapper.
 *
 * This used to say it returned true "when ANY of the documented local hosts is reachable in spirit",
 * which reads as a probe and is not a testable statement. The body has always been `return true`.
 * The distinction matters because of where this sits — see the note on the `||` chain in
 * `shouldUseRealLocalRuntime`.
 */
export function isLocalNoAuthProviderAvailable(): boolean {
  return true;
}
