/**
 * Vertex AI dispatcher (Adoption Roadmap #8; ADRs D291, D292, D301).
 *
 * `selectTransport` doesn't see the model id (the credential resolution
 * happens before request dispatch). This client inspects `request.model`
 * at stream time and delegates to either `VertexGeminiClient` (OpenAI-compat
 * for Gemini) or `VertexAnthropicClient` (`:rawPredict` for Claude).
 *
 * @internal
 */

import { inferModelDialect } from "../providers/builtin/vertex.js";
import type { LlmClient, LlmEvent, LlmFinish, LlmRequest } from "./types.js";
import { VertexAnthropicClient } from "./vertex-anthropic.js";
import { VertexGeminiClient } from "./vertex-gemini.js";

export interface VertexRouterClientOptions {
  apiKey?: string;
  fetch?: typeof fetch;
}

export class VertexRouterClient implements LlmClient {
  readonly name = "vertex";

  constructor(private readonly options: VertexRouterClientOptions) {}

  async *stream(
    request: LlmRequest,
    signal: AbortSignal,
  ): AsyncGenerator<LlmEvent, LlmFinish, void> {
    const dialect = inferModelDialect(request.model);
    if (dialect === "anthropic") {
      const inner = new VertexAnthropicClient(this.options);
      return yield* inner.stream(request, signal);
    }
    const inner = new VertexGeminiClient(this.options);
    return yield* inner.stream(request, signal);
  }
}
