/**
 * usetheokit/theokit-sdk#332 — a model must be able to name its own endpoint.
 *
 * `OLLAMA_HOST` is read from the process environment, so every `ollama/*` model in a process shared
 * one host: an app could not run a small model on `localhost` and a large one on a GPU box. The
 * information had nowhere to travel — `ProviderRouterOptions` carried no URL field at all.
 *
 * The oracle is the request, not the options object: a test that asserted what was passed into the
 * client would pass with the precedence inverted. The idiom (stub `globalThis.fetch`, drain the
 * client, assert the URL it hit) is `ollama.test.ts`'s, and works here because both transports
 * resolve `options.fetch ?? fetch`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveProviderChain } from "../../../src/internal/llm/router.js";
import {
  _resetBuiltinsRegistered,
  registerBuiltins,
} from "../../../src/internal/providers/builtin/index.js";
import { _resetProvidersForTests } from "../../../src/internal/providers/registry.js";
import type { ModelSelection } from "../../../src/types/agent-prims.js";

async function requestedUrl(options: { primary: string; baseUrl?: string }): Promise<string> {
  let url = "";
  vi.stubGlobal("fetch", (async (u: unknown) => {
    url = String(u);
    return new Response('data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n', {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  }) as unknown as typeof fetch);
  try {
    const [client] = resolveProviderChain(options);
    if (client === undefined) throw new Error(`no client for "${options.primary}"`);
    const gen = (
      client as unknown as { stream: (r: unknown, s: AbortSignal) => AsyncGenerator }
    ).stream(
      { model: "m", messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] },
      new AbortController().signal,
    );
    let r = await gen.next();
    while (!r.done) r = await gen.next();
    return url;
  } finally {
    vi.unstubAllGlobals();
  }
}

const TRACKED = ["OLLAMA_HOST", "OLLAMA_API_KEY", "LMSTUDIO_API_KEY"];
const ORIG: Record<string, string | undefined> = {};

beforeEach(() => {
  _resetProvidersForTests();
  _resetBuiltinsRegistered();
  for (const k of TRACKED) {
    ORIG[k] = process.env[k];
    delete process.env[k];
  }
  registerBuiltins();
});
afterEach(() => {
  for (const [k, v] of Object.entries(ORIG)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("a model can name its own endpoint (#332)", () => {
  it("sends to the URL the caller gave, not the profile default", async () => {
    const url = await requestedUrl({ primary: "ollama", baseUrl: "http://gpu-box:11434" });

    expect(url).toContain("gpu-box:11434");
  });

  it("lets the per-call URL win over the process-wide env var", async () => {
    process.env.OLLAMA_HOST = "http://hijacked:11434";

    const url = await requestedUrl({ primary: "ollama", baseUrl: "http://gpu-box:11434" });

    expect(url).toContain("gpu-box:11434");
    expect(url).not.toContain("hijacked");
  });

  it("falls back to the env var when no URL was given", async () => {
    process.env.OLLAMA_HOST = "http://from-env:11434";

    expect(await requestedUrl({ primary: "ollama" })).toContain("from-env:11434");
  });

  it("falls back to the profile default when neither is set", async () => {
    expect(await requestedUrl({ primary: "ollama" })).toContain("localhost:11434");
  });

  it("applies to the OpenAI-compatible transports too, not only Ollama", async () => {
    const url = await requestedUrl({ primary: "lmstudio", baseUrl: "http://other-box:1234" });

    expect(url).toContain("other-box:1234");
  });
});

describe("the public shape carries it (#332)", () => {
  it("ModelSelection accepts a url alongside the id", () => {
    // A type-level assertion: this file fails to compile if `url` is not on the public shape,
    // which is the half a runtime test cannot cover — `real-local-run.ts` reads `options.model?.url`
    // and a missing field there is a compile error, not a failing expectation.
    const selection: ModelSelection = { id: "ollama/llama3.3:70b", url: "http://gpu-box:11434" };

    expect(selection.url).toBe("http://gpu-box:11434");
  });

  it("stays optional, so the zero-config path is untouched", () => {
    const selection: ModelSelection = { id: "ollama/qwen2.5:3b" };

    expect(selection.url).toBeUndefined();
  });
});
