/**
 * GCP Vertex AI Gemini client (Adoption Roadmap #8; ADR D291).
 *
 * Uses the **OpenAI-compat** endpoint:
 *   POST https://{LOCATION}-aiplatform.googleapis.com/v1/projects/{P}/locations/{L}/endpoints/openapi/chat/completions
 *
 * Wraps `OpenAIClient` with the Vertex baseUrl + lazy OAuth token from
 * `google-auth-library` (D288). Limitation: Vertex silently drops
 * unsupported OpenAI params (D264-style trade-off).
 *
 * @internal
 */

import { ConfigurationError } from "../../errors.js";
import { resolveVertexBaseUrl } from "../providers/builtin/vertex.js";
import { OpenAIClient } from "./openai.js";
import type { LlmClient, LlmEvent, LlmFinish, LlmRequest } from "./types.js";
import {
  resolveVertexAccessToken,
  resolveVertexLocation,
  resolveVertexProjectId,
} from "./vertex-auth.js";

export interface VertexGeminiClientOptions {
  /** When undefined, resolved lazily via `resolveVertexProjectId()`. */
  projectId?: string;
  /** When undefined, resolved lazily via `resolveVertexLocation()`. */
  location?: string;
  /** When non-empty, used as-is. Otherwise resolved lazily via ADC. */
  apiKey?: string;
  fetch?: typeof fetch;
}

export class VertexGeminiClient implements LlmClient {
  readonly name = "vertex_gemini";

  constructor(private readonly options: VertexGeminiClientOptions) {}

  async *stream(
    request: LlmRequest,
    signal: AbortSignal,
  ): AsyncGenerator<LlmEvent, LlmFinish, void> {
    // EC-1 absorbed: helpful errors when projectId / token missing.
    const projectId = this.options.projectId ?? resolveVertexProjectId();
    if (projectId === undefined) {
      throw new ConfigurationError(
        "Vertex requires a project id. Set GOOGLE_CLOUD_PROJECT env var or run " +
          "`gcloud config set project <id>`.",
        { code: "auth_failed" },
      );
    }
    const location = this.options.location ?? resolveVertexLocation();
    const accessToken =
      this.options.apiKey !== undefined && this.options.apiKey.length > 0
        ? this.options.apiKey
        : await resolveVertexAccessToken();
    if (accessToken === undefined || accessToken.length === 0) {
      throw new ConfigurationError(
        "Vertex could not resolve an access token. Run " +
          "`gcloud auth application-default login` or set " +
          "GOOGLE_APPLICATION_CREDENTIALS to a service-account JSON path.",
        { code: "auth_failed" },
      );
    }

    // Vertex OpenAI-compat URL: baseUrl includes `.../endpoints/openapi`.
    // OpenAIClient appends `/v1/chat/completions` which gives the wrong path —
    // so we strip the `/v1/` suffix from our baseUrl construction by using
    // the parent URL and letting OpenAIClient add the suffix back.
    //
    // Resolved baseUrl (target):
    //   .../endpoints/openapi/chat/completions
    // OpenAIClient builds:
    //   {baseUrl}/v1/chat/completions
    // So we need baseUrl = `.../endpoints/openapi-no-suffix` such that
    //   `{baseUrl}/v1/chat/completions` = `.../endpoints/openapi/chat/completions`.
    // That's not achievable via simple concat; the cleanest path is to
    // delegate directly using a custom URL — but to keep the existing
    // OpenAIClient code-path, we set baseUrl so that the suffix is correct
    // by mounting "openapi" as the leaf and letting `/v1/chat/completions`
    // append. Vertex's documented path is exactly:
    //   .../endpoints/openapi/chat/completions      (NO /v1)
    // We achieve this by providing a base ending in `/endpoints` and
    // re-mapping `/v1/chat/completions` → `/openapi/chat/completions`
    // via a custom URL builder client.
    //
    // For v1 we ship a minimal own client that targets the exact endpoint.
    const baseUrl = resolveVertexBaseUrl({ projectId, location, modelDialect: "gemini" });
    const url = `${baseUrl}/chat/completions`;

    // Reuse OpenAIClient by injecting a baseUrl that matches its `/v1/chat/completions` suffix.
    // To avoid that suffix mismatch, we bypass OpenAIClient.stream() entirely and
    // do a direct fetch — but Gemini's response shape IS OpenAI shape, so we
    // borrow OpenAIClient's accumulator via composition: pre-build the body,
    // then hand off to OpenAIClient with a synthetic baseUrl whose `/v1/chat/completions`
    // suffix lands on our actual endpoint.
    //
    // Simplest: create a wrapper fetch that rewrites the URL before delegating.
    const innerFetch = this.options.fetch ?? fetch;
    const rewriteFetch: typeof fetch = (input, init) => {
      // OpenAIClient calls `${baseUrl}/v1/chat/completions`. We rewrite that to
      // the actual Vertex URL.
      const requested =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;
      const targetUrl = requested.endsWith("/v1/chat/completions") ? url : requested;
      return innerFetch(targetUrl, init);
    };

    // Delegate to OpenAIClient with auth + rewrite.
    const inner = new OpenAIClient({
      apiKey: accessToken,
      baseUrl: "https://_vertex_placeholder",
      providerName: "vertex",
      fetch: rewriteFetch,
    });
    return yield* inner.stream(request, signal);
  }
}
