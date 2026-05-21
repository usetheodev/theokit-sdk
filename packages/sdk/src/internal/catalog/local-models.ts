/**
 * Local model discovery via OpenAI-compatible `/v1/models` endpoint
 * (T2.1, ADR D184).
 *
 * Used by `Theokit.models.list({ provider: "ollama" })` (and any other
 * future provider with `authType: "none"` exposing the OpenAI-shape
 * models endpoint — LM Studio, llama.cpp `./server`, vLLM, etc.) to
 * enumerate locally-installed models without a cloud round-trip.
 *
 * Aligned with peer-project `extensions/ollama/src/provider-models.ts` which
 * targets the same endpoint shape. Mirrors the relevant Hermes
 * `models.dev` catalog behavior for local providers.
 *
 * @internal
 */

import { ConfigurationError } from "../../errors.js";
import type { SDKModel } from "../../types/theokit.js";
import { mapOllamaHttpError, mapOllamaTransportError } from "../errors/mappers/ollama.js";

interface OpenAiModelsResponse {
  object?: string;
  data?: Array<{ id?: string; owned_by?: string }>;
}

/**
 * Fetch and map `<baseUrl>/v1/models` → `SDKModel[]`. Throws a typed
 * `ConfigurationError` on connection failures (ECONNREFUSED → "Run
 * `ollama serve`"). Returns `[]` when the body is unparseable —
 * defensive choice over crashing on malformed responses from
 * non-standard local runtimes.
 */
export async function listLocalModelsViaOpenAiCompat(baseUrl: string): Promise<SDKModel[]> {
  const url = `${baseUrl}/v1/models`;
  let response: Response;
  try {
    response = await fetch(url, { method: "GET" });
  } catch (fetchErr) {
    const mapped = mapOllamaTransportError({
      providerId: "ollama",
      cause: fetchErr,
      endpoint: "/v1/models",
    });
    if (mapped !== undefined) throw mapped;
    throw new ConfigurationError(
      `Failed to reach local provider at ${baseUrl}: ${(fetchErr as Error).message}`,
      { code: "local_provider_unreachable" },
    );
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // keep as string
    }
    const mapped = mapOllamaHttpError({
      providerId: "ollama",
      status: response.status,
      body,
      headers: response.headers,
      endpoint: "/v1/models",
    });
    if (mapped !== undefined) throw mapped;
    throw new ConfigurationError(
      `Local provider at ${baseUrl} returned HTTP ${response.status} on /v1/models`,
      { code: "local_provider_http_error" },
    );
  }
  let parsed: OpenAiModelsResponse;
  try {
    parsed = (await response.json()) as OpenAiModelsResponse;
  } catch {
    return [];
  }
  const data = parsed.data ?? [];
  return data
    .filter(
      (entry): entry is { id: string } => typeof entry?.id === "string" && entry.id.length > 0,
    )
    .map((entry) => ({
      id: entry.id,
      displayName: entry.id,
      name: entry.id,
    }));
}
