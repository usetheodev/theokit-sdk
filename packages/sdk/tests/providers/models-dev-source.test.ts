import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetBuiltinsRegistered,
  registerBuiltins,
} from "../../src/internal/providers/builtin/index.js";
import {
  _resetModelInfoIndexForTests,
  getCatalogModelInfo,
} from "../../src/internal/providers/catalog-loader.js";
import {
  cachePathFor,
  getModelInfo,
  loadCacheIntoIndex,
  refreshModelCatalog,
} from "../../src/internal/providers/catalog-source-models-dev.js";
import { _resetProvidersForTests } from "../../src/internal/providers/registry.js";

/**
 * M44 T2.1 — the optional models-dev source. Explicit opt-in only; every failure mode fails CLOSED back to
 * the vendored/cached data; atomic cache writes; TTL by mtime; kill-switch env; unknown providers skipped.
 * A custom URL isolates each test's cache file (hash-suffixed path) — never touches the default cache.
 */

const TEST_URL = "https://models-dev-test.invalid/api.json";
const mkdirTmp = (): string => mkdtempSync(join(tmpdir(), "mds-home-"));
const goodPayload = JSON.stringify({
  openai: {
    models: {
      "test-model-x": {
        cost: { input: 1.5, output: 3 },
        limit: { context: 100000 },
        tool_call: true,
      },
    },
  },
  "unknown-provider-zzz": { models: { m: { cost: { input: 1, output: 1 } } } },
});

function cleanCache(): void {
  try {
    rmSync(cachePathFor(TEST_URL), { force: true });
  } catch {
    /* best effort */
  }
}

let _home: string;
let _prevHome: string | undefined;

beforeEach(() => {
  _resetModelInfoIndexForTests();
  _resetProvidersForTests();
  _resetBuiltinsRegistered();
  registerBuiltins();
  _prevHome = process.env.THEOKIT_HOME;
  _home = mkdirTmp();
  process.env.THEOKIT_HOME = _home; // L8 — never touch the real ~/.theokit
  cleanCache();
  delete process.env.THEOKIT_DISABLE_MODELS_FETCH;
});

afterEach(() => {
  cleanCache();
  if (_prevHome === undefined) delete process.env.THEOKIT_HOME;
  else process.env.THEOKIT_HOME = _prevHome;
  try {
    rmSync(_home, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
  delete process.env.THEOKIT_DISABLE_MODELS_FETCH;
  vi.restoreAllMocks();
});

describe("M44 — models-dev source (fail-closed, opt-in)", () => {
  it("fetch failure → WARN + vendored data still served (fail-closed)", async () => {
    const errSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const r = await refreshModelCatalog({
      url: TEST_URL,
      force: true,
      deps: {
        fetch: (async () => new Response("boom", { status: 500 })) as unknown as typeof fetch,
      },
    });
    expect(r.source).toBe("cache"); // fail-closed: no network result
    // vendored data still resolves
    expect(getCatalogModelInfo("anthropic/claude-opus-4-7")).toBeDefined();
    expect(errSpy.mock.calls.map((c) => String(c[0])).join("")).toContain("refresh failed");
  });

  it("successful refresh patches the index for KNOWN providers only (unknown skipped)", async () => {
    const r = await refreshModelCatalog({
      url: TEST_URL,
      force: true,
      deps: {
        fetch: (async () => new Response(goodPayload, { status: 200 })) as unknown as typeof fetch,
      },
    });
    expect(r.source).toBe("network");
    expect(r.models).toBe(1); // openai model patched; unknown-provider-zzz skipped
    expect(getModelInfo("openai/test-model-x")?.cost?.input).toBe(1.5);
    expect(getModelInfo("unknown-provider-zzz/m")).toBeUndefined();
  });

  it("fresh TTL cache skips the network; force fetches", async () => {
    // seed the cache
    await refreshModelCatalog({
      url: TEST_URL,
      force: true,
      deps: {
        fetch: (async () => new Response(goodPayload, { status: 200 })) as unknown as typeof fetch,
      },
    });
    let fetches = 0;
    const counting = (async () => {
      fetches++;
      return new Response(goodPayload, { status: 200 });
    }) as unknown as typeof fetch;
    const r1 = await refreshModelCatalog({ url: TEST_URL, deps: { fetch: counting } });
    expect(r1.source).toBe("cache");
    expect(fetches).toBe(0); // fresh cache → no network
    const r2 = await refreshModelCatalog({ url: TEST_URL, force: true, deps: { fetch: counting } });
    expect(r2.source).toBe("network");
    expect(fetches).toBe(1);
  });

  it("kill-switch env → refresh is a no-op {source: skipped}", async () => {
    process.env.THEOKIT_DISABLE_MODELS_FETCH = "1";
    let fetched = false;
    const r = await refreshModelCatalog({
      url: TEST_URL,
      force: true,
      deps: {
        fetch: (async () => {
          fetched = true;
          return new Response(goodPayload, { status: 200 });
        }) as unknown as typeof fetch,
      },
    });
    expect(r.source).toBe("skipped");
    expect(fetched).toBe(false);
  });

  it("corrupt cache file → deleted + vendored fallback", () => {
    const path = cachePathFor(TEST_URL);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{ not valid json !!");
    const errSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const patched = loadCacheIntoIndex(TEST_URL);
    expect(patched).toBe(0);
    expect(existsSync(path)).toBe(false); // deleted
    expect(getCatalogModelInfo("anthropic/claude-opus-4-7")).toBeDefined(); // vendored intact
    expect(errSpy.mock.calls.map((c) => String(c[0])).join("")).toContain("corrupt");
  });

  it("non-JSON 200 body is never cached (validate before persist)", async () => {
    const r = await refreshModelCatalog({
      url: TEST_URL,
      force: true,
      deps: {
        fetch: (async () =>
          new Response("<html>garbage</html>", { status: 200 })) as unknown as typeof fetch,
      },
    });
    expect(r.source).toBe("cache"); // fail-closed
    expect(existsSync(cachePathFor(TEST_URL))).toBe(false); // garbage never persisted
  });

  it("cache patch wins over vendored per model", async () => {
    const vendored = getCatalogModelInfo("openai/gpt-4o");
    expect(vendored).toBeDefined();
    const override = JSON.stringify({
      openai: { models: { "gpt-4o": { cost: { input: 99, output: 99 } } } },
    });
    await refreshModelCatalog({
      url: TEST_URL,
      force: true,
      deps: {
        fetch: (async () => new Response(override, { status: 200 })) as unknown as typeof fetch,
      },
    });
    expect(getCatalogModelInfo("openai/gpt-4o")?.cost?.input).toBe(99); // live wins
  });

  it("two concurrent refreshes: complete valid cache + ≤2 fetches + consistent index (no-flock v1)", async () => {
    let fetches = 0;
    const counting = (async () => {
      fetches++;
      await new Promise((r) => setTimeout(r, 10));
      return new Response(goodPayload, { status: 200 });
    }) as unknown as typeof fetch;
    const [a, b] = await Promise.all([
      refreshModelCatalog({ url: TEST_URL, force: true, deps: { fetch: counting } }),
      refreshModelCatalog({ url: TEST_URL, force: true, deps: { fetch: counting } }),
    ]);
    expect(fetches).toBeLessThanOrEqual(2); // at most one wasted fetch
    expect(a.source).toBe("network");
    expect(b.source).toBe("network");
    // the cache file is complete valid JSON (atomic rename — never partial)
    expect(() => JSON.parse(readFileSync(cachePathFor(TEST_URL), "utf-8"))).not.toThrow();
    expect(getModelInfo("openai/test-model-x")?.tool_call).toBe(true);
  });

  it("getModelInfo returns the enriched vendored view (cost/limit/modalities)", () => {
    const info = getModelInfo("anthropic/claude-opus-4-7");
    expect(info?.cost?.input).toBeGreaterThan(0);
    expect(info?.limit?.context).toBeGreaterThan(0);
    expect(info?.modalities?.input).toContain("text");
  });
});
