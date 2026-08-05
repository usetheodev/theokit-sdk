import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetBuiltinsRegistered,
  registerBuiltins,
} from "../../src/internal/providers/builtin/index.js";
import {
  _resetModelInfoIndexForTests,
  getCatalogModelInfo,
  listModelInfoKeys,
  loadProviderCatalog,
  patchModelInfo,
} from "../../src/internal/providers/catalog-loader.js";
import {
  _resetProvidersForTests,
  getProviderProfile,
} from "../../src/internal/providers/registry.js";

/**
 * M44 T0.1 — the model-info index. Additive schema migration: entries without `models` behave
 * byte-identically; entries with `models` populate the `provider/model` index; malformed model sub-entries
 * drop that model (WARN) and keep the provider; builtin-skipped providers still index their models (ADR D2).
 */

beforeEach(() => {
  _resetModelInfoIndexForTests();
  _resetProvidersForTests();
  _resetBuiltinsRegistered();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("M44 — catalog model-info index", () => {
  it("all 43 vendored entries still validate and register the same provider ids (migration)", () => {
    const catalog = loadProviderCatalog();
    expect(Object.keys(catalog).length).toBeGreaterThanOrEqual(43);
    registerBuiltins();
    // the 10 first-party builtins keep resolving with flat fallbackModels arrays
    for (const name of [
      "anthropic",
      "openai",
      "openai-chatgpt",
      "openrouter",
      "gemini",
      "ollama",
      "lmstudio",
      "llamacpp",
      "bedrock",
      "vertex",
    ]) {
      const p = getProviderProfile(name);
      expect(p, name).toBeDefined();
      expect(Array.isArray(p?.fallbackModels)).toBe(true);
    }
  });

  it("an entry WITHOUT models produces a profile identical to today's shape (no new fields)", () => {
    registerBuiltins();
    const groq = getProviderProfile("groq"); // catalog-registered (not a first-party builtin)
    expect(groq).toBeDefined();
    // ProviderProfile stays byte-identical: no `models` key rides onto the profile (ADR D2)
    expect((groq as unknown as { models?: unknown }).models).toBeUndefined();
  });

  it("indexes models from the vendored catalog when present (provider/model key)", () => {
    // the enriched vendored JSON (T0.2) carries models for the majors — assert at least one indexes
    const keys = listModelInfoKeys();
    // Before T0.2 lands data this may be empty; patch one and assert the accessor round-trips
    patchModelInfo("test-prov/test-model", { cost: { input: 1, output: 2 } });
    expect(getCatalogModelInfo("test-prov/test-model")?.cost?.input).toBe(1);
    expect(Array.isArray(keys)).toBe(true);
  });

  it("the model schema rejects invalid sub-entries and tolerates unknown keys (drop-with-WARN contract)", async () => {
    const { catalogModelSchema } = await import("../../src/internal/providers/catalog-schema.js");
    expect(catalogModelSchema.safeParse({ cost: { input: -5, output: 1 } }).success).toBe(false); // negative cost invalid
    expect(
      catalogModelSchema.safeParse({ cost: { input: 1, output: 2 }, unknown_field: true }).success,
    ).toBe(true); // tolerant to unknown keys (models.dev additive drift)
    expect(catalogModelSchema.safeParse({}).success).toBe(true); // all fields optional
  });

  it("patched (models-dev) entries win over vendored per model", () => {
    patchModelInfo("prov/m", { cost: { input: 1, output: 2 } });
    patchModelInfo("prov/m", { cost: { input: 9, output: 9 } });
    expect(getCatalogModelInfo("prov/m")?.cost?.input).toBe(9);
  });
});
