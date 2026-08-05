/**
 * theokit#159 — what each embedding adapter actually puts on the wire.
 *
 * The catalog advertises ten providers. `theokit#128` made the peer serve the same ten, and the
 * `/review` then observed that the shared runtime is rigidly OpenAI-shaped — one auth header, one
 * body shape, one response shape — while three of the four adapters added in T4.10 speak something
 * else. Nothing caught it because coverage for those four was metadata only: no `embed()` was ever
 * called, in either package.
 *
 * So this file calls `embed()` and records the REQUEST. It is deliberately a characterization test:
 * it asserts what the SDK sends today, provider by provider, and states in each case whether that
 * matches the provider's documented contract. Where it does not, the expectation is annotated
 * `KNOWN-BROKEN` with the divergence spelled out, so the gap is tracked in executable form rather
 * than in prose that ages out.
 *
 * Turning a KNOWN-BROKEN into a real assertion is the fix for theokit#159. Until then, this file is
 * the evidence that the analysis was measured rather than assumed.
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
 */
let probeCounter = 0;

async function embedOnce(
  adapter: { create: (o: never) => Promise<{ embed: (t: string[]) => Promise<unknown> }> },
  options: Record<string, unknown>,
): Promise<Captured> {
  const { sent, fetchImpl } = capture();
  const runtime = await adapter.create({ ...options, fetch: fetchImpl } as never);
  probeCounter += 1;
  await runtime.embed([`probe-${probeCounter}`]);
  const only = sent[0];
  if (only === undefined) throw new Error("adapter issued no request");
  return only;
}

describe("theokit#159 — embedding adapter wire contracts", () => {
  it("jina matches its documented contract end to end", async () => {
    // The one of the four that genuinely fits the shared OpenAI-compatible runtime.
    const req = await embedOnce(jinaMemoryEmbeddingProviderAdapter, {
      apiKey: "jina-key",
      model: "jina-embeddings-v3",
    });

    expect(req.url).toBe("https://api.jina.ai/v1/embeddings");
    expect(req.headers.authorization).toBe("Bearer jina-key");
    expect(req.body).toEqual({ model: "jina-embeddings-v3", input: ["probe-1"] });
  });

  it("azure-openai puts the deployment in the path, but KNOWN-BROKEN on auth and body", async () => {
    const req = await embedOnce(azureOpenAiMemoryEmbeddingProviderAdapter, {
      apiKey: "azure-key",
      baseUrl: "https://my-resource.openai.azure.com",
      model: "text-embedding-3-large",
    });

    // Fixed by theokit#128: the deployment really is substituted into the path.
    expect(req.url).toBe(
      "https://my-resource.openai.azure.com/openai/deployments/text-embedding-3-large/embeddings?api-version=2024-02-01",
    );

    // KNOWN-BROKEN (theokit#159): Azure authenticates an API key via the `api-key` header. `Bearer`
    // is for Entra ID tokens, not for the key read from AZURE_OPENAI_API_KEY.
    expect(req.headers.authorization).toBe("Bearer azure-key");
    expect(req.headers["api-key"], "KNOWN-BROKEN: Azure expects this header").toBeUndefined();

    // KNOWN-BROKEN (theokit#159): the deployment is already in the path; `model` in the body is
    // not part of the Azure request.
    expect(req.body).toHaveProperty("model");
  });

  it("cohere is KNOWN-BROKEN in both directions", async () => {
    const req = await embedOnce(cohereMemoryEmbeddingProviderAdapter, {
      apiKey: "cohere-key",
      model: "embed-english-v3.0",
    });

    expect(req.url).toBe("https://api.cohere.com/v2/embed");

    // KNOWN-BROKEN (theokit#159): `/v2/embed` takes `{model, texts, input_type, embedding_types}`.
    // The runtime sends the OpenAI `{model, input}` shape.
    expect(req.body).toEqual({ model: "embed-english-v3.0", input: ["probe-3"] });
    expect(req.body, "KNOWN-BROKEN: Cohere names this `texts`").not.toHaveProperty("texts");
    expect(req.body, "KNOWN-BROKEN: Cohere requires `input_type`").not.toHaveProperty("input_type");
    // Response is also divergent (`{embeddings:{float:[]}}` vs the required `data`), which this
    // stubbed fetch cannot exercise — `parseEmbedResponse` demands `data` and would throw
    // `embedding_invalid_response` against the real API.
  });

  it("gemini targets a path its OpenAI-compat surface does not serve — KNOWN-BROKEN", async () => {
    const req = await embedOnce(geminiMemoryEmbeddingProviderAdapter, {
      apiKey: "gemini-key",
      model: "text-embedding-004",
    });

    // KNOWN-BROKEN (theokit#159): the compat surface lives under `/v1beta/openai/`, so this 404s.
    expect(req.url).toBe("https://generativelanguage.googleapis.com/v1/embeddings");
    expect(req.url, "KNOWN-BROKEN: expected the /v1beta/openai/ compat prefix").not.toContain(
      "/v1beta/openai/",
    );
  });

  it("the shared runtime is OpenAI-shaped, which is WHY three of four diverge", async () => {
    // The root cause in one assertion: one auth scheme, one body shape, for every provider.
    const req = await embedOnce(jinaMemoryEmbeddingProviderAdapter, {
      apiKey: "k",
      model: "jina-embeddings-v3",
    });

    expect(Object.keys(req.headers).sort()).toEqual(["authorization", "content-type"]);
    expect(Object.keys(req.body).sort()).toEqual(["input", "model"]);
  });
});
