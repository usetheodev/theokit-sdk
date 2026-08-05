import { beforeEach, describe, expect, it } from "vitest";

import {
  _resetModelInfoIndexForTests,
  getCatalogModelInfo,
  listModelInfoKeys,
} from "../../src/internal/providers/catalog-loader.js";

/**
 * M44 T0.2 — the enriched vendored JSON + id mapping. Vendor-keyed lookups (the EXACT-map convention the
 * capabilities resolver uses) resolve through entry aliases (google-gemini alias "google", zhipu alias
 * "z-ai"). Every former EXACT key with a real model resolves from the index.
 */

beforeEach(() => _resetModelInfoIndexForTests());

describe("M44 — enriched vendored catalog + id mapping", () => {
  it("vendored models are indexed (30+ across entries)", () => {
    expect(listModelInfoKeys().length).toBeGreaterThanOrEqual(30);
  });

  it("per-builtin vendor keys resolve (anthropic/openai/google/z-ai)", () => {
    expect(getCatalogModelInfo("anthropic/claude-opus-4-7")?.cost?.input).toBeGreaterThan(0);
    expect(getCatalogModelInfo("openai/gpt-4o")?.limit?.context).toBeGreaterThan(0);
    // vendor alias: entry google-gemini, alias google — the EXACT-map key convention
    expect(getCatalogModelInfo("google/gemini-2.5-pro")).toBeDefined();
    expect(getCatalogModelInfo("z-ai/glm-4.7-flash")).toBeDefined();
  });

  it("every former EXACT key (with a model part) resolves from the index", async () => {
    const { readFileSync } = await import("node:fs");
    const snapshot = JSON.parse(
      readFileSync(new URL("../fixtures/exact-map-snapshot.json", import.meta.url), "utf-8"),
    ) as Record<string, unknown>;
    const missing: string[] = [];
    for (const key of Object.keys(snapshot)) {
      if (key.endsWith("/")) continue; // prefix-strip rules, not models
      if (getCatalogModelInfo(key) === undefined) missing.push(key);
    }
    expect(missing).toEqual([]);
  });
});
