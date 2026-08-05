/**
 * theokit#128 (RED-first) — the Azure OpenAI embedding endpoint carries the deployment IN THE PATH.
 *
 * Found while porting the four missing adapters into `@theokit/sdk-memory` for the catalog-parity
 * fix: the Azure adapter declares
 * `embeddingsPath: "/openai/deployments/{model}/embeddings?api-version=..."`, but
 * `createOpenAiCompatibleRuntime` appends `embeddingsPath` verbatim. So every Azure request went to
 * a URL containing the literal five characters `{model}` and could only 404. Porting that as-is
 * would have duplicated the defect into a second package.
 *
 * Every other provider passes a static path, so this is the one adapter the gap could reach.
 */
import { describe, expect, it } from "vitest";
import { azureOpenAiMemoryEmbeddingProviderAdapter } from "../../../../src/internal/memory/adapters/azure-openai-embedding.js";

/** Captures the URL of the single embed request, and replies with a well-formed vector. */
function captureUrl(): { urls: string[]; fetchImpl: typeof fetch } {
  const urls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3] }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { urls, fetchImpl };
}

describe("theokit#128 — Azure OpenAI embeddings URL", () => {
  it("test_deployment_name_is_substituted_into_the_path", async () => {
    const { urls, fetchImpl } = captureUrl();
    const runtime = await azureOpenAiMemoryEmbeddingProviderAdapter.create({
      apiKey: "azure-test-key",
      baseUrl: "https://my-resource.openai.azure.com",
      model: "text-embedding-3-large",
      fetch: fetchImpl,
    });

    await runtime.embed(["hello"]);

    expect(urls).toHaveLength(1);
    expect(urls[0]).toBe(
      "https://my-resource.openai.azure.com/openai/deployments/text-embedding-3-large/embeddings?api-version=2024-02-01",
    );
    // The assertion that names the actual defect: a URL nobody templated.
    expect(urls[0], "an untemplated path 404s on every request").not.toContain("{model}");
  });

  it("test_COUNTERPROOF_a_provider_with_a_static_path_is_untouched", async () => {
    // Substitution must not rewrite paths that never asked for it — otherwise the fix would be a
    // behaviour change for the nine other adapters.
    const { urls, fetchImpl } = captureUrl();
    const { openAiMemoryEmbeddingProviderAdapter } = await import(
      "../../../../src/internal/memory/adapters/openai-embedding.js"
    );
    const runtime = await openAiMemoryEmbeddingProviderAdapter.create({
      apiKey: "sk-test",
      baseUrl: "https://api.openai.com",
      model: "text-embedding-3-small",
      fetch: fetchImpl,
    });

    await runtime.embed(["hello"]);

    expect(urls[0]).toBe("https://api.openai.com/v1/embeddings");
  });
});
