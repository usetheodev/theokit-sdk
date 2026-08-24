/**
 * theokit#159 — what each embedding adapter actually puts on the wire.
 *
 * The catalog advertises ten providers. `theokit#128` made the peer serve the same ten, and the
 * `/review` then observed that the shared runtime is rigidly OpenAI-shaped — one auth header, one
 * body shape, one response shape — while three of the four adapters added in T4.10 speak something
 * else. Nothing caught it because coverage for those four was metadata only: no `embed()` was ever
 * called, in either package.
 *
 * So this file calls `embed()` and records the REQUEST, provider by provider.
 *
 * It started as a characterization test with the divergences annotated `KNOWN-BROKEN`. They are now
 * real assertions: each of the three speaks its own dialect through the runtime's `dialect` hooks,
 * and this file is what proves it rather than asserting it in prose.
 */
import { describe, expect, it } from "vitest";
import { azureOpenAiMemoryEmbeddingProviderAdapter } from "../../../../src/internal/memory/adapters/azure-openai-embedding.js";
import { cohereMemoryEmbeddingProviderAdapter } from "../../../../src/internal/memory/adapters/cohere-embedding.js";
import { geminiMemoryEmbeddingProviderAdapter } from "../../../../src/internal/memory/adapters/gemini-embedding.js";
import { jinaMemoryEmbeddingProviderAdapter } from "../../../../src/internal/memory/adapters/jina-embedding.js";

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** Captures the outgoing request and replies with an OpenAI-shaped embedding response. */
function capture(): { sent: Captured[]; fetchImpl: typeof fetch } {
  const sent: Captured[] = [];
  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    sent.push({
      url: String(input),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    });
    return new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2] }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { sent, fetchImpl };
}

/**
 * Every call uses a UNIQUE text on purpose. The shared runtime caches by `sha256(model + text)` in
 * a process-wide cache (T4.4), so reusing one string makes the second adapter call a cache hit that
 * issues no HTTP request at all — which reads as "the adapter sent nothing" and would quietly
 * hollow out this whole file.
 *
 * B-059: the probe text used to come from a file-level mutable `probeCounter` incremented by every
 * `it()` body. Under intra-file concurrency (shuffled + parallel), concurrent bodies raced the
 * increment, so a test could observe a different `probe-N` than the one its own assertion hardcoded
 * — reproduced 3/3 runs under `vitest.shuffle.config.ts`. The fix removes the shared counter: each
 * call site now owns its probe text and passes it in explicitly, so there is no mutable state for
 * concurrent test bodies to race.
 */
async function embedOnce(
  adapter: { create: (o: never) => Promise<{ embed: (t: string[]) => Promise<unknown> }> },
  options: Record<string, unknown>,
  probeText: string,
): Promise<Captured> {
  const { sent, fetchImpl } = capture();
  const runtime = await adapter.create({ ...options, fetch: fetchImpl } as never);
  await runtime.embed([probeText]);
  const only = sent[0];
  if (only === undefined) throw new Error("adapter issued no request");
  return only;
}

describe("theokit#159 — embedding adapter wire contracts", () => {
  it("jina matches its documented contract end to end", async () => {
    // The one of the four that genuinely fits the shared OpenAI-compatible runtime.
    const req = await embedOnce(
      jinaMemoryEmbeddingProviderAdapter,
      { apiKey: "jina-key", model: "jina-embeddings-v3" },
      "probe-jina-contract",
    );

    expect(req.url).toBe("https://api.jina.ai/v1/embeddings");
    expect(req.headers.authorization).toBe("Bearer jina-key");
    expect(req.body).toEqual({ model: "jina-embeddings-v3", input: ["probe-jina-contract"] });
  });

  it("azure-openai authenticates with api-key and keeps the deployment in the path", async () => {
    const req = await embedOnce(
      azureOpenAiMemoryEmbeddingProviderAdapter,
      {
        apiKey: "azure-key",
        baseUrl: "https://my-resource.openai.azure.com",
        model: "text-embedding-3-large",
      },
      "probe-azure-contract",
    );

    // Fixed by theokit#128: the deployment really is substituted into the path.
    expect(req.url).toBe(
      "https://my-resource.openai.azure.com/openai/deployments/text-embedding-3-large/embeddings?api-version=2024-02-01",
    );

    // theokit#159 — Azure authenticates an API key with the `api-key` header. `Bearer` carries an
    // Entra ID token, not the key read from AZURE_OPENAI_API_KEY.
    expect(req.headers["api-key"]).toBe("azure-key");
    expect(req.headers.authorization).toBeUndefined();

    // The deployment is already in the path, so `model` has no place in the body.
    expect(req.body).toEqual({ input: ["probe-azure-contract"] });
  });

  it("cohere speaks the /v2/embed request shape", async () => {
    const req = await embedOnce(
      cohereMemoryEmbeddingProviderAdapter,
      { apiKey: "cohere-key", model: "embed-english-v3.0" },
      "probe-cohere-contract",
    );

    expect(req.url).toBe("https://api.cohere.com/v2/embed");

    // theokit#159 — `/v2/embed` names the payload `texts` and requires `input_type`.
    expect(req.body).toEqual({
      model: "embed-english-v3.0",
      texts: ["probe-cohere-contract"],
      input_type: "search_document",
      embedding_types: ["float"],
    });
  });

  it("gemini targets the /v1beta/openai compat surface", async () => {
    const req = await embedOnce(
      geminiMemoryEmbeddingProviderAdapter,
      { apiKey: "gemini-key", model: "text-embedding-004" },
      "probe-gemini-contract",
    );

    // theokit#159 — the compat surface lives under `/v1beta/openai/`; `/v1/embeddings` 404'd.
    expect(req.url).toBe("https://generativelanguage.googleapis.com/v1beta/openai/embeddings");
  });

  it("cohere reads vectors out of its own response shape", async () => {
    // The other half of Cohere's divergence, and the one the request-shape test cannot reach:
    // `/v2/embed` answers `{embeddings:{float:[[...]]}}`. `parseEmbedResponse` demands `data`, so
    // before the dialect hook this threw `embedding_invalid_response` on every successful call.
    const sent: Captured[] = [];
    const fetchImpl = (async (input: unknown, init?: RequestInit) => {
      sent.push({
        url: String(input),
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
      });
      return new Response(JSON.stringify({ id: "x", embeddings: { float: [[0.25, 0.75]] } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const runtime = await cohereMemoryEmbeddingProviderAdapter.create({
      apiKey: "cohere-key",
      model: "embed-english-v3.0",
      fetch: fetchImpl,
    } as never);
    const vectors = await runtime.embed(["cohere-response-probe"]);

    expect(sent).toHaveLength(1);
    expect(vectors[0]?.slice(0, 2)).toEqual([0.25, 0.75]);
  });

  it("the OpenAI default is unchanged for every provider that does speak it", async () => {
    // The counterproof for the dialect hooks: adding them must not alter the seven providers that
    // were always correct. Defaults are exactly the previous behaviour.
    const req = await embedOnce(
      jinaMemoryEmbeddingProviderAdapter,
      { apiKey: "k", model: "jina-embeddings-v3" },
      "probe-jina-default-check",
    );

    expect(Object.keys(req.headers).sort()).toEqual(["authorization", "content-type"]);
    expect(Object.keys(req.body).sort()).toEqual(["input", "model"]);
  });
});
