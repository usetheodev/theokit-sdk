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
 * rewriting the URL inside an injected `fetch`.
 *
 * What the rewrite test pins is the URL the provider RECEIVES — scoped deliberately. Review showed the
 * rewrite's defensive branches could not be reached from here: `OpenAIClient` calls `fetch` exactly
 * once, with a template-literal string (openai.ts:169), so the `URL`/`Request` input forms never
 * occurred and the `endsWith` guard was never false. Filed as B-103; resolved by removing the
 * unreachable branches at the source (vertex-gemini.ts) rather than pinning them with a test that
 * would have to fabricate a caller nothing has.
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

/**
 * A `fetch` that fails the test if it is ever called.
 *
 * The two guard tests assert the client refuses BEFORE reaching the network. Left unstubbed, a guard
 * that stops firing turns the test into a live HTTPS call whose failure looks like a flaky API rather
 * than the regression it is.
 */
function refusingFetch(): typeof fetch {
  return (async (input: unknown) => {
    throw new Error(`the guard should have refused before any request; got ${String(input)}`);
  }) as unknown as typeof fetch;
}

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
    //
    // Review found this deleting only ONE of the three keys `resolveVertexProjectId` reads
    // (vertex-auth.ts:84 falls through GOOGLE_CLOUD_PROJECT → GOOGLE_CLOUD_PROJECT_ID →
    // GCLOUD_PROJECT). With `GCLOUD_PROJECT` exported the guard did not fire — and since the client
    // was built with no `fetch`, the test then made a REAL request to googleapis.com and failed on a
    // live API error 1.2s later. A developer with `gcloud` configured is exactly the population that
    // has that variable set, so it failed for the people most likely to touch Vertex.
    for (const key of ["GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_PROJECT_ID", "GCLOUD_PROJECT"]) {
      delete process.env[key];
    }
    __setVertexAuthClientForTests({ getAccessToken: async () => ({ token: "vt" }) });

    // A guard that fails to fire must surface as a loud test failure, never as network traffic.
    const err = await run(new VertexGeminiClient({ fetch: refusingFetch() }));
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

    const err = await run(new VertexGeminiClient({ fetch: refusingFetch() }));
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

    await run(new VertexGeminiClient({ apiKey: "explicit-key", fetch: fetchImpl }));

    // Review refuted the reasoning I first wrote here, by mutation rather than by argument. I claimed
    // that consulting ADC would surface the stub's throw. It does not: `resolveVertexAccessToken`
    // swallows it (vertex-auth.ts:42-48, `catch { return undefined }`). So no implementation could
    // put that message into the error, and asserting its absence could never fail. Forcing the module
    // to always consult ADC left that assertion green — the header is what killed the mutant.
    //
    // The header is therefore the entire oracle, and it is a real one: the request carries the key
    // that was handed in, which holds only if ADC was bypassed. The returned error is not inspected
    // at all — a non-empty `headers` already proves the request was issued, and whatever
    // `OpenAIClient` makes of a bodyless response is its own tests' subject.
    expect(
      JSON.stringify(headers),
      "the explicit key must be what authenticates the call, not a resolved one",
    ).toContain("explicit-key");
  });
});
