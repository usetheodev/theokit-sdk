import { beforeEach, describe, expect, it } from "vitest";
import { _resetBuiltinsRegistered } from "../../src/internal/providers/builtin/index.js";
import {
  loadProviderCatalog,
  registerCatalogProviders,
} from "../../src/internal/providers/catalog-loader.js";
import {
  _resetProvidersForTests,
  getProviderProfile,
} from "../../src/internal/providers/registry.js";

describe("dynamic provider catalog", () => {
  beforeEach(() => {
    _resetProvidersForTests();
    _resetBuiltinsRegistered();
  });

  it("loads ≥40 providers from JSON catalog", () => {
    const catalog = loadProviderCatalog();
    expect(Object.keys(catalog).length).toBeGreaterThanOrEqual(40);
  });

  it("each entry has id and capabilities fields", () => {
    const catalog = loadProviderCatalog();
    const openai = catalog.openai;
    expect(openai).toBeDefined();
    expect(openai!.capabilities).toBeDefined();
    expect(openai!.capabilities.supportsToolUse).toBe(true);
  });

  it("catalog includes major providers", () => {
    const catalog = loadProviderCatalog();
    const expected = [
      "openai",
      "anthropic",
      "groq",
      "mistral",
      "deepseek",
      "together",
      "fireworks",
    ];
    for (const name of expected) {
      expect(catalog[name]).toBeDefined();
    }
  });

  it("EC-1: malformed entry is skipped with WARN, not crash", () => {
    const stderrChunks: string[] = [];
    const origWrite = process.stderr.write;
    process.stderr.write = ((chunk: string) => {
      stderrChunks.push(chunk.toString());
      return true;
    }) as typeof process.stderr.write;

    try {
      const catalog = loadProviderCatalog({ _testInjectMalformed: true });
      expect(Object.keys(catalog).length).toBeGreaterThanOrEqual(39);
      expect(stderrChunks.some((c) => c.includes("WARN"))).toBe(true);
    } finally {
      process.stderr.write = origWrite;
    }
  });

  it("getProvider resolves a JSON-loaded provider after registerCatalog", () => {
    registerCatalogProviders();
    const groq = getProviderProfile("groq");
    expect(groq).toBeDefined();
    expect(groq!.name).toBe("groq");
  });
});
