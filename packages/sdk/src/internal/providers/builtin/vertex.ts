/**
 * GCP Vertex AI profile (Adoption Roadmap #8; ADRs D286-D302).
 *
 * Required peer dep: `google-auth-library` (D288). Resolves access tokens
 * via ADC (env → gcloud → metadata server → WIF).
 *
 * Model IDs follow the convention `vertex/{dialect}/{model}`:
 *   - `vertex/google/gemini-2.0-flash-001` → OpenAI-compat endpoint (D291)
 *   - `vertex/anthropic/claude-sonnet-4-5@20250929` → :rawPredict (D292)
 *
 * @internal
 */

import type { ProviderProfile } from "../types.js";

export const VERTEX: ProviderProfile = {
  name: "vertex",
  apiMode: "anthropic_messages", // sub-dispatched in selectTransport by profile.name
  envVars: ["GOOGLE_APPLICATION_CREDENTIALS"],
  authType: "gcp_oauth",
  baseUrl: "https://us-central1-aiplatform.googleapis.com",
  modelsUrl: undefined,
  hostname: "aiplatform.googleapis.com",
  fallbackModels: [
    "vertex/anthropic/claude-sonnet-4-5@20250929",
    "vertex/google/gemini-2.0-flash-001",
  ],
};

/**
 * D293 absorbed: when location === "global", use `aiplatform.googleapis.com`
 * (no `global-` prefix) — known bug `streamRawPredict` 404 at
 * `global-aiplatform.googleapis.com` (cline#10287).
 */
export function resolveVertexBaseUrl(opts: {
  projectId: string;
  location: string;
  modelDialect: "anthropic" | "gemini";
}): string {
  const host =
    opts.location === "global"
      ? "aiplatform.googleapis.com"
      : `${opts.location}-aiplatform.googleapis.com`;
  if (opts.modelDialect === "gemini") {
    // OpenAI-compat endpoint (D291) — the client appends `/chat/completions`.
    return `https://${host}/v1/projects/${opts.projectId}/locations/${opts.location}/endpoints/openapi`;
  }
  // Anthropic — base URL up to `/publishers/anthropic` (model id appended by client).
  return `https://${host}/v1/projects/${opts.projectId}/locations/${opts.location}/publishers/anthropic`;
}

/** Detect dialect from a `vertex/{dialect}/{model}` id. Default: gemini. */
export function inferModelDialect(modelId: string): "anthropic" | "gemini" {
  if (modelId.includes("/anthropic/")) return "anthropic";
  if (modelId.includes("/google/")) return "gemini";
  return "gemini";
}

/** Strip the `vertex/{dialect}/` prefix so the raw model id is used in the URL. */
export function stripVertexPrefix(modelId: string): string {
  return modelId.replace(/^vertex\/(anthropic|google)\//, "");
}
