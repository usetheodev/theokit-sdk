import { createHash } from "node:crypto";

import { AuthenticationError, NetworkError, RateLimitError } from "../../../errors.js";
import type {
  CreateAdapterOptions,
  EmbeddingRuntime,
  EmbeddingRuntimeStats,
} from "../embedding-adapter.js";
import { LruEmbeddingCache } from "../embedding-cache.js";

/**
 * Shared factory for OpenAI-compatible embedding providers (OpenAI, Mistral,
 * DeepInfra, and anything else exposing `POST /v1/embeddings` with the
 * `{ model, input }` request shape and `{ data: [{ embedding }] }` response).
 *
 * Mirrors the inner mechanics of OpenClaw's batch embedding runtime.
 *
 * @internal
 */

const MAX_BATCH = 100;
const MAX_RETRIES = 2;

export interface OpenAiCompatibleConfig {
  id: string;
  defaultBaseUrl: string;
  apiKeyEnv: string;
  baseUrlEnv?: string;
  defaultModel: string;
  /** Best-effort dimension hint by model id. */
  dimensionByModel: Record<string, number>;
}

export async function createOpenAiCompatibleRuntime(
  cfg: OpenAiCompatibleConfig,
  options: CreateAdapterOptions,
): Promise<EmbeddingRuntime> {
  const model = options.model ?? cfg.defaultModel;
  const apiKey = options.apiKey ?? process.env[cfg.apiKeyEnv];
  if (apiKey === undefined || apiKey.length === 0) {
    throw new AuthenticationError(`${cfg.apiKeyEnv} missing`, {
      code: "embedding_missing_api_key",
    });
  }
  const envBaseUrl = cfg.baseUrlEnv !== undefined ? process.env[cfg.baseUrlEnv] : undefined;
  const baseUrl = options.baseUrl ?? envBaseUrl ?? cfg.defaultBaseUrl;
  const fetchImpl = options.fetch ?? fetch;
  const cache = options.cache ?? new LruEmbeddingCache();
  const dimension = cfg.dimensionByModel[model] ?? 1536;

  const stats: EmbeddingRuntimeStats = {
    cacheHits: 0,
    cacheMisses: 0,
    httpCalls: 0,
    retries: 0,
  };

  return {
    id: cfg.id,
    model,
    dimension,
    stats: () => ({ ...stats }),
    embed: (texts) =>
      embedTexts({
        texts,
        cache,
        stats,
        model,
        dimension,
        apiKey,
        baseUrl,
        fetchImpl,
        providerId: cfg.id,
      }),
  };
}

interface EmbedTextsInput {
  texts: ReadonlyArray<string>;
  cache: NonNullable<CreateAdapterOptions["cache"]>;
  stats: EmbeddingRuntimeStats;
  model: string;
  dimension: number;
  apiKey: string;
  baseUrl: string;
  fetchImpl: typeof fetch;
  providerId: string;
}

async function embedTexts(input: EmbedTextsInput): Promise<number[][]> {
  const { texts, cache, stats, model, dimension } = input;
  const results = new Array<number[] | undefined>(texts.length);
  const pending: Array<{ index: number; text: string; key: string }> = [];
  for (let i = 0; i < texts.length; i++) {
    classifyEntry({
      index: i,
      text: texts[i] ?? "",
      model,
      dimension,
      cache,
      stats,
      results,
      pending,
    });
  }
  await runBatches(input, pending, results);
  return results.map((v) => v ?? new Array(dimension).fill(0));
}

interface ClassifyEntryArgs {
  index: number;
  text: string;
  model: string;
  dimension: number;
  cache: NonNullable<CreateAdapterOptions["cache"]>;
  stats: EmbeddingRuntimeStats;
  results: Array<number[] | undefined>;
  pending: Array<{ index: number; text: string; key: string }>;
}

function classifyEntry(args: ClassifyEntryArgs): void {
  if (args.text.trim().length === 0) {
    args.results[args.index] = new Array(args.dimension).fill(0);
    return;
  }
  const key = hashKey(args.model, args.text);
  const cached = args.cache.get(key);
  if (cached !== undefined) {
    args.stats.cacheHits += 1;
    args.results[args.index] = cached;
    return;
  }
  args.stats.cacheMisses += 1;
  args.pending.push({ index: args.index, text: args.text, key });
}

async function runBatches(
  input: EmbedTextsInput,
  pending: ReadonlyArray<{ index: number; text: string; key: string }>,
  results: Array<number[] | undefined>,
): Promise<void> {
  for (let offset = 0; offset < pending.length; offset += MAX_BATCH) {
    const batch = pending.slice(offset, offset + MAX_BATCH);
    const vectors = await embedBatch({
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      model: input.model,
      inputs: batch.map((b) => b.text),
      fetchImpl: input.fetchImpl,
      stats: input.stats,
      providerId: input.providerId,
    });
    for (let j = 0; j < batch.length; j++) {
      const slot = batch[j];
      const vector = vectors[j];
      if (slot === undefined || vector === undefined) continue;
      results[slot.index] = vector;
      input.cache.set(slot.key, vector);
    }
  }
}

interface BatchOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  inputs: ReadonlyArray<string>;
  fetchImpl: typeof fetch;
  stats: EmbeddingRuntimeStats;
  providerId: string;
}

async function embedBatch(opts: BatchOptions): Promise<number[][]> {
  const url = `${opts.baseUrl.replace(/\/$/, "")}/v1/embeddings`;
  let attempt = 0;
  while (true) {
    opts.stats.httpCalls += 1;
    const response = await postEmbedRequest(opts, url);
    if (response.ok) return await parseEmbedResponse(response, opts.providerId);
    if (isRetryable(response.status) && attempt < MAX_RETRIES) {
      attempt += 1;
      opts.stats.retries += 1;
      await sleep(linearBackoffMs(attempt));
      continue;
    }
    throw mapErrorStatus(opts.providerId, response.status);
  }
}

async function postEmbedRequest(opts: BatchOptions, url: string): Promise<Response> {
  return opts.fetchImpl(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({ model: opts.model, input: opts.inputs }),
  });
}

async function parseEmbedResponse(response: Response, providerId: string): Promise<number[][]> {
  const json = (await response.json()) as { data?: Array<{ embedding: number[] }> };
  if (!Array.isArray(json.data)) {
    throw new NetworkError(`${providerId} /v1/embeddings returned no data`, {
      code: "embedding_invalid_response",
    });
  }
  return json.data.map((d) => d.embedding);
}

function isRetryable(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

function mapErrorStatus(providerId: string, status: number): Error {
  if (status === 401) {
    return new AuthenticationError(`${providerId} /v1/embeddings rejected the API key (401)`, {
      code: "embedding_unauthorized",
    });
  }
  if (status === 429) {
    return new RateLimitError(`${providerId} /v1/embeddings rate limit exhausted`, {
      code: "embedding_rate_limit",
    });
  }
  return new NetworkError(`${providerId} /v1/embeddings returned ${status}`, {
    code: "embedding_http_error",
  });
}

function hashKey(model: string, text: string): string {
  return createHash("sha256").update(`${model} ${text}`).digest("hex");
}

function linearBackoffMs(attempt: number): number {
  return 50 * attempt;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
