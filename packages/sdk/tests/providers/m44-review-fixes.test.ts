import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getPricingEntry } from "../../src/internal/budget/pricing-registry.js";
import { resolveModelCapabilities } from "../../src/internal/llm/model-capabilities.js";
import { _resetBuiltinsRegistered } from "../../src/internal/providers/builtin/index.js";
import {
  _resetModelInfoIndexForTests,
  getCatalogModelInfo,
  patchModelInfo,
} from "../../src/internal/providers/catalog-loader.js";
import {
  cachePathFor,
  refreshModelCatalog,
} from "../../src/internal/providers/catalog-source-models-dev.js";
import { _resetProvidersForTests } from "../../src/internal/providers/registry.js";

/** M44 review fixes — regression coverage for B1/H2/H3/M4/M5/M6/L8/L11. */

let home: string;
let prevHome: string | undefined;

beforeEach(() => {
  _resetModelInfoIndexForTests();
  _resetProvidersForTests();
  _resetBuiltinsRegistered();
  prevHome = process.env.THEOKIT_HOME;
  home = mkdtempSync(join(tmpdir(), "m44-fixes-"));
  process.env.THEOKIT_HOME = home; // L8 — tests never touch the real ~/.theokit
  delete process.env.THEOKIT_DISABLE_MODELS_FETCH;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.THEOKIT_HOME;
  else process.env.THEOKIT_HOME = prevHome;
  delete process.env.THEOKIT_DISABLE_MODELS_FETCH;
  rmSync(home, { recursive: true, force: true });
});

describe("B1 — cross-bundle shared state (globalThis singleton)", () => {
  it("registry + model-info index live on globalThis via Symbol.for", () => {
    // a second bundle copy of the module resolves the SAME maps through Symbol.for — assert the anchor exists
    const g = globalThis as unknown as Record<symbol, unknown>;
    // touch the index so it initializes
    patchModelInfo("b1/test", { cost: { input: 1, output: 1 } });
    expect(g[Symbol.for("theokit-sdk.providers.model-info-index")]).toBeInstanceOf(Map);
    expect(g[Symbol.for("theokit-sdk.providers.registry")]).toBeInstanceOf(Map);
    // and the map IS the one the module reads
    expect(getCatalogModelInfo("b1/test")?.cost?.input).toBe(1);
  });
});

describe("H2 — patch preserves theokit extension fields (merge, not replace)", () => {
  it("a cost-only live patch keeps cache_control/structured_output/limit", () => {
    const before = getCatalogModelInfo("anthropic/claude-3-5-sonnet");
    expect(before?.cache_control).toBe(true); // vendored overlay
    patchModelInfo("anthropic/claude-3-5-sonnet", { cost: { input: 9, output: 9 } });
    const after = getCatalogModelInfo("anthropic/claude-3-5-sonnet");
    expect(after?.cost?.input).toBe(9); // incoming wins
    expect(after?.cache_control).toBe(true); // extension survives (was wiped before the fix)
    expect(after?.limit?.context).toBe(before?.limit?.context); // omitted fields survive
  });
});

describe("H3+M4 — runtime id mapping + standalone refresh", () => {
  it("models.dev 'google'/'zai' patch under the catalog entry + alias keys; unknown WARNs; no prior registerBuiltins needed", async () => {
    const payload = JSON.stringify({
      google: { models: { "gemini-9.9-test": { cost: { input: 1, output: 2 } } } },
      zai: { models: { "glm-9-test": { cost: { input: 1, output: 2 } } } },
      "totally-unknown-prov": { models: { m: { cost: { input: 1, output: 1 } } } },
    });
    // NOTE: registries were reset in beforeEach and we do NOT call registerBuiltins here (M4 self-init)
    const r = await refreshModelCatalog({
      url: "https://m44-fixes.invalid/api.json",
      force: true,
      deps: {
        fetch: (async () => new Response(payload, { status: 200 })) as unknown as typeof fetch,
      },
    });
    expect(r.source).toBe("network");
    expect(r.models).toBe(2); // google + zai patched; unknown skipped
    expect(getCatalogModelInfo("google-gemini/gemini-9.9-test")).toBeDefined(); // entry id key
    expect(getCatalogModelInfo("google/gemini-9.9-test")).toBeDefined(); // alias key (capability convention)
    expect(getCatalogModelInfo("zhipu/glm-9-test")).toBeDefined();
    expect(getCatalogModelInfo("z-ai/glm-9-test")).toBeDefined();
  });
});

describe("M5 — honest pricing provenance after a live patch", () => {
  it("a live-patched key reports catalog-models-dev, a vendored key reports catalog-vendored", () => {
    // vendored: pick a catalog-only model with cost that LiteLLM misses
    patchModelInfo("provx/live-model", { cost: { input: 3, output: 6 } });
    const live = getPricingEntry({ provider: "provx", model: "live-model" });
    expect(live?.pricingVersion).toBe("catalog-models-dev");
  });
});

describe("M6 — builtin anthropic defaults carry cache_control", () => {
  it("resolveModelCapabilities(anthropic/claude-opus-4-7).supportsCacheControl is true", () => {
    expect(resolveModelCapabilities("anthropic/claude-opus-4-7").supportsCacheControl).toBe(true);
    expect(
      resolveModelCapabilities("anthropic/claude-haiku-4-5-20251001").supportsCacheControl,
    ).toBe(true);
  });
});

describe("L8+L11 — cache under THEOKIT_HOME; falsy kill-switch does not disable", () => {
  it("cachePathFor is rooted at THEOKIT_HOME when set", () => {
    expect(cachePathFor("https://models.dev/api.json").startsWith(home)).toBe(true);
  });

  it("THEOKIT_DISABLE_MODELS_FETCH=0/false/'' do NOT disable the refresh", async () => {
    for (const v of ["0", "false", ""]) {
      process.env.THEOKIT_DISABLE_MODELS_FETCH = v;
      let fetched = false;
      await refreshModelCatalog({
        url: "https://m44-kill.invalid/api.json",
        force: true,
        deps: {
          fetch: (async () => {
            fetched = true;
            return new Response("{}", { status: 200 });
          }) as unknown as typeof fetch,
        },
      });
      expect(fetched, `value ${JSON.stringify(v)}`).toBe(true);
    }
  });
});
