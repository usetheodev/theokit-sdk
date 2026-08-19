/**
 * B-001 residue — `VertexRouterClient` executed in no test at all (`FNDA:0` on both its functions).
 *
 * The router's entire behaviour is a two-way choice: read the model id, dispatch to the Anthropic
 * client or the Gemini one. Both branches return a working async generator, so an object-shaped
 * assertion passes with the branches swapped; the only observable difference is which endpoint the
 * provider actually sees. So the oracle is the requested URL (plan ADR D1) — the contract, rather
 * than the fact that the router happens to construct a client per call, which it should stay free to
 * change.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { LlmRequest } from "../../src/internal/llm/types.js";
import {
  __resetVertexAuth,
  __setVertexAuthClientForTests,
} from "../../src/internal/llm/vertex-auth.js";
import { VertexRouterClient } from "../../src/internal/llm/vertex-router.js";

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env = { ...originalEnv };
  process.env.GOOGLE_CLOUD_PROJECT = "proj-1";
  process.env.GOOGLE_CLOUD_LOCATION = "us-central1";
  __resetVertexAuth();
  __setVertexAuthClientForTests({ getAccessToken: async () => ({ token: "vt-token" }) });
});
afterEach(() => {
  process.env = originalEnv;
  __resetVertexAuth();
});

/** Captures the URL the client requests and answers with an empty, well-formed response. */
function capturingFetch(seen: string[]): typeof fetch {
  return (async (input: unknown, _init?: RequestInit) => {
    seen.push(
      typeof input === "string" ? input : input instanceof URL ? input.toString() : String(input),
    );
    return {
      ok: true,
      status: 200,
      json: async () => ({ content: [], stop_reason: "end_turn", choices: [] }),
      text: async () => "",
      body: null,
      headers: new Headers({ "content-type": "application/json" }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

async function drain(gen: AsyncGenerator<unknown, unknown, void>): Promise<void> {
  try {
    for await (const _ of gen) void _;
  } catch {
    // The dispatch has already happened by the time a body-shape error could surface — this test is
    // about WHERE the request went, and swallowing here keeps that separate from the inner clients'
    // own parsing, which their own tests cover.
  }
}

function request(model: string): LlmRequest {
  return { model, messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] };
}

describe("VertexRouterClient — the dispatch is the whole behaviour", () => {
  it("test_an_anthropic_model_id_reaches_the_raw_predict_endpoint", async () => {
    const seen: string[] = [];
    const client = new VertexRouterClient({ fetch: capturingFetch(seen) });
    await drain(
      client.stream(
        request("vertex/anthropic/claude-sonnet-4-5@20250929"),
        new AbortController().signal,
      ),
    );

    expect(seen, "the router must issue exactly one upstream request").toHaveLength(1);
    expect(seen[0], "an Anthropic id belongs on the :rawPredict path").toContain(":rawPredict");
    expect(seen[0], "and under the anthropic publisher").toContain("/publishers/anthropic");
  });

  it("test_a_gemini_model_id_reaches_the_openai_compat_endpoint", async () => {
    const seen: string[] = [];
    const client = new VertexRouterClient({ fetch: capturingFetch(seen) });
    await drain(
      client.stream(request("vertex/google/gemini-2.0-flash"), new AbortController().signal),
    );

    expect(seen).toHaveLength(1);
    expect(seen[0], "a Gemini id belongs on the OpenAI-compat path").toContain(
      "/endpoints/openapi/chat/completions",
    );
    expect(seen[0], "and must not be sent to the Anthropic publisher").not.toContain(
      "/publishers/anthropic",
    );
  });

  it("test_an_id_naming_no_dialect_defaults_to_gemini", async () => {
    // `inferModelDialect` documents gemini as the default. Routing an unrecognised id to Anthropic
    // instead would fail at the provider, far from the router that chose it.
    const seen: string[] = [];
    const client = new VertexRouterClient({ fetch: capturingFetch(seen) });
    await drain(client.stream(request("vertex/some-new-model"), new AbortController().signal));

    expect(seen[0]).toContain("/endpoints/openapi/chat/completions");
  });
});
