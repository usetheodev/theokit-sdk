/**
 * B-096 — unit tests for the shared model probe. Deterministic: `fetch` is
 * stubbed, so these run identically whether or not Ollama is installed.
 *
 * The behaviour that matters is the failure direction. Every suite gates on
 * this function, so anything it cannot confirm MUST read as "skip", never as
 * "run" — the defect it exists to fix was a gate that ran on an unconfirmed
 * model.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { probeOllamaModel, serverModelName } from "./ollama-probe.js";

function stubFetch(impl: () => Promise<unknown>): void {
  vi.stubGlobal("fetch", impl as unknown as typeof fetch);
}

function tagsResponse(names: string[]): Promise<unknown> {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ models: names.map((name) => ({ name })) }),
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("probeOllamaModel (B-096)", () => {
  it("test_reports_true_when_the_server_lists_the_model", async () => {
    stubFetch(() => tagsResponse(["qwen2.5:3b", "llama3.2:3b"]));
    await expect(probeOllamaModel("llama3.2")).resolves.toBe(true);
  });

  it("test_reports_false_when_the_server_is_up_but_the_model_is_absent", async () => {
    // The exact shape of B-096: reachable server, different models pulled.
    stubFetch(() => tagsResponse(["qwen2.5:3b", "qwen2.5:1.5b"]));
    await expect(probeOllamaModel("llama3.2")).resolves.toBe(false);
  });

  it("test_matches_on_prefix_so_a_tagged_name_still_resolves", async () => {
    stubFetch(() => tagsResponse(["llama3.2:3b"]));
    await expect(probeOllamaModel("llama3.2")).resolves.toBe(true);
  });

  it("test_reports_false_on_a_non_ok_response", async () => {
    stubFetch(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }));
    await expect(probeOllamaModel("llama3.2")).resolves.toBe(false);
  });

  it("test_reports_false_when_the_body_has_no_models_key", async () => {
    stubFetch(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
    await expect(probeOllamaModel("llama3.2")).resolves.toBe(false);
  });

  it("test_reports_false_when_the_request_throws", async () => {
    stubFetch(() => Promise.reject(new Error("ECONNREFUSED")));
    await expect(probeOllamaModel("llama3.2")).resolves.toBe(false);
  });

  it("test_reports_false_when_the_body_is_not_json", async () => {
    stubFetch(() =>
      Promise.resolve({ ok: true, json: () => Promise.reject(new Error("bad json")) }),
    );
    await expect(probeOllamaModel("llama3.2")).resolves.toBe(false);
  });

  it("test_strips_the_ollama_prefix_the_suites_configure", () => {
    expect(serverModelName("ollama/llama3.2:3b")).toBe("llama3.2:3b");
    expect(serverModelName("llama3.2:3b")).toBe("llama3.2:3b");
  });
});
