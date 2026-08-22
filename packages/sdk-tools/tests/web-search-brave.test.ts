import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createWebSearchTool } from "../src/web-search.js";
import { createBraveWebSearchAdapter } from "../src/web-search-brave.js";
import { textHandler } from "./text-handler.js";

const KEY = "test-brave-key";

/** Build a stub `fetch` that captures the request and returns a canned JSON body. */
function stubFetch(body: unknown, init?: { ok?: boolean; status?: number; jsonThrows?: boolean }) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = async (url: string, reqInit?: RequestInit): Promise<Response> => {
    calls.push({ url, init: reqInit });
    return {
      ok: init?.ok ?? true,
      status: init?.status ?? 200,
      json: async () => {
        if (init?.jsonThrows) throw new Error("malformed body");
        return body;
      },
    } as Response;
  };
  return { fetchImpl, calls };
}

const SAMPLE = {
  web: { results: [{ title: "T1", url: "https://a.example", description: "snippet one" }] },
};

let savedKey: string | undefined;
beforeEach(() => {
  savedKey = process.env.BRAVE_API_KEY;
  delete process.env.BRAVE_API_KEY;
});
afterEach(() => {
  if (savedKey === undefined) delete process.env.BRAVE_API_KEY;
  else process.env.BRAVE_API_KEY = savedKey;
});

describe("createBraveWebSearchAdapter — mapping", () => {
  it("maps a Brave response to WebSearchResult[]", async () => {
    const { fetchImpl } = stubFetch(SAMPLE);
    const adapter = createBraveWebSearchAdapter({ apiKey: KEY, fetchImpl });
    const results = await adapter("test", 5);
    expect(results).toEqual([{ title: "T1", url: "https://a.example", snippet: "snippet one" }]);
  });

  it("maps an empty / odd response to [] (no throw)", async () => {
    for (const body of [{}, { web: {} }, { web: { results: [] } }, null]) {
      const { fetchImpl } = stubFetch(body);
      const adapter = createBraveWebSearchAdapter({ apiKey: KEY, fetchImpl });
      expect(await adapter("q", 5)).toEqual([]);
    }
  });

  it("coerces partial result fields to strings", async () => {
    const { fetchImpl } = stubFetch({ web: { results: [{ url: "https://x" }] } });
    const adapter = createBraveWebSearchAdapter({ apiKey: KEY, fetchImpl });
    const [r] = await adapter("q", 5);
    expect(r).toEqual({ title: "", url: "https://x", snippet: "" });
  });

  it("coerces non-string result fields to strings", async () => {
    const { fetchImpl } = stubFetch({
      web: { results: [{ title: 123, url: null, description: true }] },
    });
    const adapter = createBraveWebSearchAdapter({ apiKey: KEY, fetchImpl });
    const [r] = await adapter("q", 5);
    expect(r).toEqual({ title: "123", url: "", snippet: "true" });
  });
});

describe("createBraveWebSearchAdapter — endpoint validation", () => {
  it("throws at creation on a malformed endpoint (fail-early)", () => {
    // B-079 — was bare `.toThrow()`. Reclassified during triage: this guard is
    // `new URL(endpoint)` (web-search-brave.ts:52) — the WHATWG URL parser's own
    // `TypeError [ERR_INVALID_URL]`, not our own code. Pinning a platform
    // built-in's class buys nothing (same rationale as the Zod/Node-stdlib
    // carve-out); the message is the only thing worth asserting.
    expect(() => createBraveWebSearchAdapter({ apiKey: KEY, endpoint: "not a url" })).toThrow(
      /Invalid URL/,
    );
  });
});

describe("createBraveWebSearchAdapter — env + auth", () => {
  it("throws ConfigurationError at creation when no key is available", () => {
    expect(() => createBraveWebSearchAdapter({})).toThrowError(/BRAVE_API_KEY/);
    try {
      createBraveWebSearchAdapter({});
    } catch (err) {
      expect((err as { code?: string }).code).toBe("no_api_key");
    }
  });

  it("uses an explicit apiKey over the env var", () => {
    expect(() => createBraveWebSearchAdapter({ apiKey: KEY })).not.toThrow();
  });

  it("reads the key from process.env.BRAVE_API_KEY", () => {
    process.env.BRAVE_API_KEY = "from-env";
    expect(() => createBraveWebSearchAdapter({})).not.toThrow();
  });

  it("sets the X-Subscription-Token header and q/count query params", async () => {
    const { fetchImpl, calls } = stubFetch(SAMPLE);
    const adapter = createBraveWebSearchAdapter({ apiKey: KEY, fetchImpl });
    await adapter("hello world", 3);
    const call = calls[0];
    expect(call).toBeDefined();
    const headers = call?.init?.headers as Record<string, string>;
    expect(headers["X-Subscription-Token"]).toBe(KEY);
    expect(call?.url).toContain("count=3");
    expect(call?.url).toContain("q=hello+world");
  });
});

describe("createBraveWebSearchAdapter — error propagation", () => {
  it("throws on a non-ok HTTP response", async () => {
    // B-079 — was bare `.rejects.toThrow()`. `createBraveWebSearchAdapter`'s
    // request path throws a plain `Error` on `!res.ok` (web-search-brave.ts:61)
    // — genuinely untyped in our own code. The message embeds the status code,
    // so it is distinctive enough to identify the guard without a class.
    const { fetchImpl } = stubFetch({}, { ok: false, status: 401 });
    const adapter = createBraveWebSearchAdapter({ apiKey: KEY, fetchImpl });
    await expect(adapter("q", 5)).rejects.toThrow(/brave_search_failed: HTTP 401/);
  });

  it("propagates a malformed-JSON-body rejection (EC-1)", async () => {
    // B-079 — was bare `.rejects.toThrow()`. The adapter does not catch
    // `res.json()` failures at all (fail-loud pass-through); the thrown error
    // here is the test's own stub (`new Error("malformed body")`, this file's
    // `stubFetch`), not a production error. Asserting the message proves the
    // rejection is propagated unmodified rather than swallowed or reshaped.
    const { fetchImpl } = stubFetch({}, { ok: true, jsonThrows: true });
    const adapter = createBraveWebSearchAdapter({ apiKey: KEY, fetchImpl });
    await expect(adapter("q", 5)).rejects.toThrow(/malformed body/);
  });

  it("composes with createWebSearchTool: error → search_failed (tool untouched)", async () => {
    const { fetchImpl } = stubFetch({}, { ok: false, status: 500 });
    const tool = createWebSearchTool({
      search: createBraveWebSearchAdapter({ apiKey: KEY, fetchImpl }),
    });
    const parsed = JSON.parse(await textHandler(tool)({ query: "q" }));
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe("search_failed");
  });

  it("composes with createWebSearchTool: success → {ok:true,results}", async () => {
    const { fetchImpl } = stubFetch(SAMPLE);
    const tool = createWebSearchTool({
      search: createBraveWebSearchAdapter({ apiKey: KEY, fetchImpl }),
    });
    const parsed = JSON.parse(await textHandler(tool)({ query: "q" }));
    expect(parsed.ok).toBe(true);
    expect(parsed.results).toEqual([
      { title: "T1", url: "https://a.example", snippet: "snippet one" },
    ]);
  });
});

describe("sdk-tools barrel — brave adapter", () => {
  it("re-exports createBraveWebSearchAdapter", async () => {
    const mod = await import("../src/index.js");
    expect(typeof mod.createBraveWebSearchAdapter).toBe("function");
  });
});
