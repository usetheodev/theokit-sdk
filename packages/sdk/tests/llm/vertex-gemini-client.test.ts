/**
 * B-001 residue — `VertexGeminiClient` executed in no test at all (`FNDA:0` on all three functions).
 *
 * Two of the things under test here exist only to be read by a human in trouble: the guards produce
 * a `ConfigurationError` naming the env var or the `gcloud` command that fixes it. An untested guard
 * is a message nobody has ever read, and these are the messages a user meets on their first attempt
 * to use Vertex.
 *
 * The third is the URL rewrite. `OpenAIClient` builds `{baseUrl}/v1/chat/completions`; Vertex's
 * OpenAI-compat path is `.../endpoints/openapi/chat/completions`, with no `/v1`. The source carries
 * four paragraphs working through why the obvious composition cannot express that, and settles on
 * rewriting the URL inside an injected `fetch`. String surgery reached by nothing is correct only by
 * accident.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ConfigurationError } from "../../src/errors.js";
import type { LlmRequest } from "../../src/internal/llm/types.js";
import {
  __resetVertexAuth,
  __setVertexAuthClientForTests,
} from "../../src/internal/llm/vertex-auth.js";
import { VertexGeminiClient } from "../../src/internal/llm/vertex-gemini.js";

const REQ: LlmRequest = {
  model: "vertex/google/gemini-2.0-flash",
  messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
};

const originalEnv = { ...process.env };
beforeEach(() => {
  process.env = { ...originalEnv };
  __resetVertexAuth();
});
afterEach(() => {
  process.env = originalEnv;
  __resetVertexAuth();
});

/** Drives the generator far enough for the guards / the first request to happen. */
async function run(client: VertexGeminiClient): Promise<unknown> {
  const gen = client.stream(REQ, new AbortController().signal);
  return gen.next().then(
    () => null,
    (e: unknown) => e,
  );
}

describe("VertexGeminiClient — the guards a user meets first", () => {
  it("test_a_missing_project_id_names_the_env_var_and_the_gcloud_command", async () => {
    // The guard reads ABSENCE. Assigning `undefined` to a `process.env` key stores the string
    // "undefined", which is present and non-empty — the opposite of the state under test.
    delete process.env.GOOGLE_CLOUD_PROJECT;
    __setVertexAuthClientForTests({ getAccessToken: async () => ({ token: "vt" }) });

    const err = await run(new VertexGeminiClient({}));
    expect(err).toBeInstanceOf(ConfigurationError);
    // The message IS the feature — a user who cannot act on it is a user who files a bug instead.
    expect((err as Error).message, "must name the env var to set").toContain(
      "GOOGLE_CLOUD_PROJECT",
    );
    expect((err as Error).message, "and the command that sets it").toContain("gcloud config set");
  });

  it("test_a_missing_access_token_names_the_adc_login", async () => {
    process.env.GOOGLE_CLOUD_PROJECT = "proj-1";
    // `null` is what the real ADC client returns when the chain is exhausted; `resolveVertexAccessToken`
    // maps it to `undefined`, which is what the guard reads. Stubbing `undefined` here would model a
    // shape the library never produces — and tsc rejects it, correctly.
    __setVertexAuthClientForTests({ getAccessToken: async () => ({ token: null }) });

    const err = await run(new VertexGeminiClient({}));
    expect(err).toBeInstanceOf(ConfigurationError);
    expect((err as Error).message, "must name the ADC login").toContain(
      "application-default login",
    );
    expect((err as Error).message, "and the service-account alternative").toContain(
      "GOOGLE_APPLICATION_CREDENTIALS",
    );
  });
});

describe("VertexGeminiClient — the URL rewrite the comments argue about", () => {
  it("test_the_openai_client_suffix_is_rewritten_onto_the_vertex_path", async () => {
    process.env.GOOGLE_CLOUD_PROJECT = "proj-1";
    process.env.GOOGLE_CLOUD_LOCATION = "us-central1";
    __setVertexAuthClientForTests({ getAccessToken: async () => ({ token: "vt-token" }) });

    const seen: string[] = [];
    const fetchImpl = (async (input: unknown) => {
      seen.push(typeof input === "string" ? input : String(input));
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [] }),
        text: async () => "",
        body: null,
        headers: new Headers({ "content-type": "application/json" }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    await run(new VertexGeminiClient({ fetch: fetchImpl }));

    expect(seen, "the rewrite must not swallow the request").toHaveLength(1);
    expect(seen[0], "the documented Vertex path carries no /v1 before chat/completions").toBe(
      "https://us-central1-aiplatform.googleapis.com/v1/projects/proj-1/locations/us-central1/endpoints/openapi/chat/completions",
    );
    expect(seen[0], "the placeholder base must never reach the network").not.toContain(
      "_vertex_placeholder",
    );
  });

  it("test_an_explicit_api_key_is_used_instead_of_resolving_credentials", async () => {
    process.env.GOOGLE_CLOUD_PROJECT = "proj-1";
    // Resolution would throw if it were consulted — that is the assertion: an explicit key wins.
    __setVertexAuthClientForTests({
      getAccessToken: async () => {
        throw new Error("ADC must not be consulted when an explicit key was supplied");
      },
    });

    const headers: Array<Record<string, string>> = [];
    const fetchImpl = (async (_input: unknown, init?: RequestInit) => {
      headers.push((init?.headers ?? {}) as Record<string, string>);
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [] }),
        text: async () => "",
        body: null,
        headers: new Headers({ "content-type": "application/json" }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const err = await run(new VertexGeminiClient({ apiKey: "explicit-key", fetch: fetchImpl }));

    // Reaching the transport at all is the proof: had ADC been consulted, the stub above would have
    // thrown and that message would be here instead. What DOES surface is `OpenAIClient` refusing a
    // body with no SSE frames — the inner client's own parsing, which its own tests cover, and which
    // is only reachable once authentication has already succeeded.
    expect(
      (err as Error | null)?.message ?? "",
      "ADC must not be consulted when an explicit key was supplied",
    ).not.toContain("must not be consulted");
    expect(JSON.stringify(headers), "the explicit key is what authenticates the call").toContain(
      "explicit-key",
    );
  });
});
