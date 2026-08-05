/**
 * theokit#160 — the peer's embedding runtime must put the SAME request on the wire as core's.
 *
 * `@theokit/sdk` and `@theokit/sdk-memory` each carry a full copy of `createOpenAiCompatibleRuntime`,
 * and the peer's catalog REPLACES core's at runtime when installed — so the peer is the copy that
 * actually runs while core's is the one most people read. theokit#128 was that duplication producing
 * a two-month bug, and the gate that fix added compares provider IDs only. The `{model}` path fix
 * had to be hand-applied to both files; nothing asserted the two agree on behaviour.
 *
 * ## What this test can and cannot do
 *
 * A live side-by-side comparison would need to import core's adapters, which are internal and have
 * no public sub-path. Widening the public surface to make a test possible is the wrong trade, so
 * this file instead pins the peer against the SAME literal expectations that
 * `packages/sdk/tests/internal/memory/adapters/embedding-wire-contract.test.ts` pins core against.
 *
 * That is weaker than a direct comparison — the two files could be edited in lockstep — but it
 * fails the moment ONE copy drifts, which is the failure mode theokit#128 actually exhibited. The
 * real fix remains deduplication; this is the guard until then, and it should be deleted when the
 * peer consumes core's runtime.
 */
import * as sdkMemory from "@theokit/sdk-memory";
import { describe, expect, it } from "vitest";

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

type Adapter = { create: (o: never) => Promise<{ embed: (t: string[]) => Promise<unknown> }> };

/** Unique per call: the runtime caches by `sha256(model + text)`, and a hit issues no request. */
let probe = 0;

async function requestFrom(adapter: Adapter, options: Record<string, unknown>): Promise<Captured> {
  const sent: Captured[] = [];
  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    sent.push({
      url: String(input),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    });
    return new Response(JSON.stringify({ data: [{ embedding: [0.5] }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;

  const runtime = await adapter.create({ ...options, fetch: fetchImpl } as never);
  probe += 1;
  await runtime.embed([`parity-probe-${probe}`]);
  const only = sent[0];
  if (only === undefined) throw new Error("adapter issued no request");
  return only;
}

const catalog = sdkMemory.MEMORY_EMBEDDING_ADAPTERS as unknown as Record<string, Adapter>;

describe("theokit#160 — peer embedding runtime matches core's wire contract", () => {
  it("test_azure_substitutes_the_deployment_into_the_path_in_the_PEER_copy_too", async () => {
    // The exact fix theokit#128 had to apply twice by hand. If only core's copy had received it,
    // every consumer WITH the satellite installed would still be sending `{model}` verbatim.
    const req = await requestFrom(catalog["azure-openai"] as Adapter, {
      apiKey: "azure-key",
      baseUrl: "https://my-resource.openai.azure.com",
      model: "text-embedding-3-large",
    });

    expect(req.url).toBe(
      "https://my-resource.openai.azure.com/openai/deployments/text-embedding-3-large/embeddings?api-version=2024-02-01",
    );
    expect(req.url).not.toContain("{model}");
  });

  it("test_the_peer_runtime_is_OpenAI_shaped_exactly_as_core_is", async () => {
    // Core's contract test pins this same shape. Either copy gaining an auth scheme or a body field
    // the other lacks breaks one of the two files.
    const req = await requestFrom(catalog.jina as Adapter, {
      apiKey: "jina-key",
      model: "jina-embeddings-v3",
    });

    expect(req.url).toBe("https://api.jina.ai/v1/embeddings");
    expect(Object.keys(req.headers).sort()).toEqual(["authorization", "content-type"]);
    expect(req.headers.authorization).toBe("Bearer jina-key");
    expect(Object.keys(req.body).sort()).toEqual(["input", "model"]);
  });

  it("test_every_remote_adapter_in_the_peer_catalog_can_build_a_request", async () => {
    // theokit#128 shipped four adapters into the peer that no test had ever invoked. This calls
    // every remote one; an adapter that throws on `create` or issues no request fails here.
    const remoteOptions: Record<string, Record<string, unknown>> = {
      openai: { apiKey: "k", model: "text-embedding-3-small" },
      mistral: { apiKey: "k", model: "mistral-embed" },
      voyage: { apiKey: "k", model: "voyage-3-lite" },
      deepinfra: { apiKey: "k", model: "BAAI/bge-large-en-v1.5" },
      openrouter: { apiKey: "k", model: "openai/text-embedding-3-small" },
      "azure-openai": {
        apiKey: "k",
        baseUrl: "https://r.openai.azure.com",
        model: "text-embedding-3-small",
      },
      cohere: { apiKey: "k", model: "embed-english-v3.0" },
      jina: { apiKey: "k", model: "jina-embeddings-v3" },
      gemini: { apiKey: "k", model: "text-embedding-004" },
    };

    for (const [id, options] of Object.entries(remoteOptions)) {
      const adapter = catalog[id];
      expect(adapter, `the peer must serve ${id}`).toBeDefined();
      const req = await requestFrom(adapter as Adapter, options);
      expect(req.url, `${id} must build an absolute URL`).toMatch(/^https:\/\//);
    }
  });

  it("test_ollama_is_excluded_deliberately_not_by_omission", () => {
    // `transport: "local"` with a sentinel key and a different base-URL contract; comparing it
    // against a remote-shaped request would assert nothing useful.
    expect(catalog.ollama).toBeDefined();
  });
});
