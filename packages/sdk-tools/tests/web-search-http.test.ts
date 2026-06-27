import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWebSearchTool } from "../src/web-search.js";
import { createGenericHttpSearchAdapter } from "../src/web-search-http.js";

const KEY = "test-http-key";
const ENDPOINT = "https://search.example/api";

/** Build a stub `fetch` that captures the request and returns a canned JSON body. */
function stubFetch(
  body: unknown,
  init?: { ok?: boolean; status?: number; jsonThrows?: boolean; fetchThrows?: boolean },
) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = (async (url: string, reqInit?: RequestInit): Promise<Response> => {
    calls.push({ url, init: reqInit });
    if (init?.fetchThrows) throw new Error("network down");
    return {
      ok: init?.ok ?? true,
      status: init?.status ?? 200,
      json: async () => {
        if (init?.jsonThrows) throw new Error("malformed body");
        return body;
      },
    } as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const SAMPLE = {
  results: [{ title: "T1", url: "https://a.example", snippet: "snippet one" }],
};

let savedKey: string | undefined;
let savedUrl: string | undefined;
beforeEach(() => {
  savedKey = process.env.THEOKIT_SEARCH_API_KEY;
  savedUrl = process.env.THEOKIT_SEARCH_API_URL;
  delete process.env.THEOKIT_SEARCH_API_KEY;
  delete process.env.THEOKIT_SEARCH_API_URL;
});
afterEach(() => {
  if (savedKey === undefined) delete process.env.THEOKIT_SEARCH_API_KEY;
  else process.env.THEOKIT_SEARCH_API_KEY = savedKey;
  if (savedUrl === undefined) delete process.env.THEOKIT_SEARCH_API_URL;
  else process.env.THEOKIT_SEARCH_API_URL = savedUrl;
});

describe("createGenericHttpSearchAdapter — unconfigured", () => {
  it("returns [] when neither apiKey nor endpoint is available (no throw, no fetch)", async () => {
    const { fetchImpl, calls } = stubFetch(SAMPLE);
    const adapter = createGenericHttpSearchAdapter({ fetchImpl });
    expect(await adapter("q", 5)).toEqual([]);
    expect(calls.length).toBe(0);
  });

  it("returns [] when only apiKey is set (endpoint missing)", async () => {
    const adapter = createGenericHttpSearchAdapter({ apiKey: KEY });
    expect(await adapter("q", 5)).toEqual([]);
  });
});

describe("createGenericHttpSearchAdapter — mapping + request shape", () => {
  it("maps a generic response to WebSearchResult[]", async () => {
    const { fetchImpl, calls } = stubFetch(SAMPLE);
    const adapter = createGenericHttpSearchAdapter({ apiKey: KEY, endpoint: ENDPOINT, fetchImpl });
    const results = await adapter("hello world", 3);
    expect(results).toEqual([{ title: "T1", url: "https://a.example", snippet: "snippet one" }]);
    const call = calls[0];
    expect(call?.url).toContain("q=hello%20world");
    expect(call?.url).toContain("n=3");
    const headers = call?.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${KEY}`);
  });

  it("coerces missing fields to empty strings", async () => {
    const { fetchImpl } = stubFetch({ results: [{ url: "https://x" }] });
    const adapter = createGenericHttpSearchAdapter({ apiKey: KEY, endpoint: ENDPOINT, fetchImpl });
    expect(await adapter("q", 5)).toEqual([{ title: "", url: "https://x", snippet: "" }]);
  });

  it("caps results to maxResults", async () => {
    const many = { results: Array.from({ length: 10 }, (_, i) => ({ title: `t${i}` })) };
    const { fetchImpl } = stubFetch(many);
    const adapter = createGenericHttpSearchAdapter({ apiKey: KEY, endpoint: ENDPOINT, fetchImpl });
    expect((await adapter("q", 2)).length).toBe(2);
  });

  it("reads key + endpoint from env vars when not passed", async () => {
    process.env.THEOKIT_SEARCH_API_KEY = "from-env";
    process.env.THEOKIT_SEARCH_API_URL = ENDPOINT;
    const { fetchImpl, calls } = stubFetch(SAMPLE);
    const adapter = createGenericHttpSearchAdapter({ fetchImpl });
    await adapter("q", 5);
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer from-env");
  });
});

describe("createGenericHttpSearchAdapter — graceful failure (never throws into the turn)", () => {
  it("returns [] on a non-ok HTTP response", async () => {
    const { fetchImpl } = stubFetch({}, { ok: false, status: 500 });
    const adapter = createGenericHttpSearchAdapter({ apiKey: KEY, endpoint: ENDPOINT, fetchImpl });
    expect(await adapter("q", 5)).toEqual([]);
  });

  it("returns [] on a fetch network error", async () => {
    const { fetchImpl } = stubFetch({}, { fetchThrows: true });
    const adapter = createGenericHttpSearchAdapter({ apiKey: KEY, endpoint: ENDPOINT, fetchImpl });
    expect(await adapter("q", 5)).toEqual([]);
  });

  it("returns [] on a malformed JSON body", async () => {
    const { fetchImpl } = stubFetch({}, { jsonThrows: true });
    const adapter = createGenericHttpSearchAdapter({ apiKey: KEY, endpoint: ENDPOINT, fetchImpl });
    expect(await adapter("q", 5)).toEqual([]);
  });
});

describe("createGenericHttpSearchAdapter — composes with createWebSearchTool", () => {
  it("unconfigured adapter → tool returns ok:true with empty results", async () => {
    const tool = createWebSearchTool({ search: createGenericHttpSearchAdapter({}) });
    const parsed = JSON.parse(await tool.handler({ query: "q" }));
    expect(parsed.ok).toBe(true);
    expect(parsed.results).toEqual([]);
  });

  it("configured adapter → tool returns mapped results", async () => {
    const { fetchImpl } = stubFetch(SAMPLE);
    const tool = createWebSearchTool({
      search: createGenericHttpSearchAdapter({ apiKey: KEY, endpoint: ENDPOINT, fetchImpl }),
    });
    const parsed = JSON.parse(await tool.handler({ query: "q" }));
    expect(parsed.ok).toBe(true);
    expect(parsed.results).toEqual([
      { title: "T1", url: "https://a.example", snippet: "snippet one" },
    ]);
  });
});

describe("sdk-tools barrel — generic http adapter", () => {
  it("re-exports createGenericHttpSearchAdapter", async () => {
    const mod = await import("../src/index.js");
    expect(typeof mod.createGenericHttpSearchAdapter).toBe("function");
  });
});
