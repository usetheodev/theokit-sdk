/**
 * Tests for local model discovery (T2.1, ADR D184).
 *
 * `listLocalModelsViaOpenAiCompat(baseUrl)` fetches `<baseUrl>/v1/models`
 * and maps the OpenAI-shape response (`{ data: [{ id, ... }] }`) into the
 * SDK's `SDKModel[]` shape. Used by `Theokit.models.list({ provider: "ollama" })`
 * to enumerate locally-installed Ollama models without a cloud round-trip.
 *
 * Aligned with peer-project `extensions/ollama/src/provider-models.ts` (which
 * uses the same `/v1/models` endpoint) and the OpenAI `models.list` API
 * spec — providers wanting `authType: "none"` discovery only need to
 * expose this endpoint.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConfigurationError } from "../../src/errors.js";
import { listLocalModelsViaOpenAiCompat } from "../../src/internal/catalog/local-models.js";

const realFetch = global.fetch;

beforeEach(() => {
  // Default to a fetch that fails — individual tests stub.
  global.fetch = vi.fn() as unknown as typeof fetch;
});
afterEach(() => {
  global.fetch = realFetch;
});

describe("listLocalModelsViaOpenAiCompat (D184)", () => {
  it("maps OpenAI-shape /v1/models response into SDKModel[]", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          object: "list",
          data: [
            { id: "llama3.2:3b", object: "model", owned_by: "library" },
            { id: "qwen2.5-coder:7b", object: "model", owned_by: "library" },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const models = await listLocalModelsViaOpenAiCompat("http://localhost:11434");

    expect(models).toHaveLength(2);
    expect(models[0]?.id).toBe("llama3.2:3b");
    expect(models[0]?.displayName).toBe("llama3.2:3b");
    expect(models[1]?.id).toBe("qwen2.5-coder:7b");
  });

  it("empty server response → empty array", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({ object: "list", data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const models = await listLocalModelsViaOpenAiCompat("http://localhost:11434");
    expect(models).toEqual([]);
  });

  it("connection refused → ConfigurationError ollama_unreachable", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      Object.assign(new TypeError("fetch failed"), {
        cause: { code: "ECONNREFUSED" },
      }),
    );

    await expect(listLocalModelsViaOpenAiCompat("http://localhost:11434")).rejects.toThrow(
      /ollama serve|not reachable/i,
    );
  });

  it("non-2xx response → ConfigurationError", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response("Internal Server Error", { status: 500 }),
    );

    // B-079 — was bare `.rejects.toThrow()`, despite the test's own name
    // already naming the class. `mapOllamaHttpError` does not special-case
    // 500 + "internal server error", so it falls through to the typed
    // `ConfigurationError` (local-models.ts:61) with code
    // `local_provider_http_error`. Single call — `mockResolvedValueOnce` only
    // covers one invocation; a second call would hit the default (unrelated)
    // mock and assert the wrong path.
    let rejectedWith: unknown;
    await listLocalModelsViaOpenAiCompat("http://localhost:11434").catch((err) => {
      rejectedWith = err;
    });
    expect(rejectedWith).toBeInstanceOf(ConfigurationError);
    expect((rejectedWith as { code?: string }).code).toBe("local_provider_http_error");
  });

  it("malformed JSON body → empty array (defensive)", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response("not json", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(listLocalModelsViaOpenAiCompat("http://localhost:11434")).resolves.toEqual([]);
  });
});
