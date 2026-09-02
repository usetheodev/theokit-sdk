import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it } from "vitest";

import { getPricingEntry } from "../../../src/internal/budget/pricing-registry.js";
import {
  _resetModelInfoIndexForTests,
  getCatalogModelInfo,
  listModelInfoKeys,
} from "../../../src/internal/providers/catalog-loader.js";

/**
 * M44 T1.2 — pricing step-5 catalog fallback (ADR D3: feeds, never replaces). LiteLLM entries keep absolute
 * precedence; a total miss consults the catalog cost with honest provenance; no fabricated zeros.
 */

beforeEach(() => _resetModelInfoIndexForTests());

describe("M44 — getPricingEntry step-5 catalog fallback", () => {
  it("LiteLLM hit is unchanged (absolute precedence, litellm provenance)", () => {
    const e = getPricingEntry({ provider: "openai", model: "gpt-4o" });
    expect(e).toBeDefined();
    expect(e?.pricingVersion).not.toBe("catalog-vendored"); // the snapshot wins
  });

  it("total LiteLLM miss resolves from the catalog with pricingVersion catalog-vendored", () => {
    // claude-haiku-4-5-20251001 is vendored in the catalog (builtin fallback model); pick one absent
    // from pricing-data.json — find a catalog key with cost that pricing-data misses
    const key = listModelInfoKeys().find((k) => {
      const [prov, ...m] = k.split("/");
      const cost = getCatalogModelInfo(k)?.cost;
      if (cost === undefined) return false;
      const litellm = getPricingEntry({ provider: prov!, model: m.join("/") });
      return litellm === undefined || litellm.pricingVersion === "catalog-vendored";
    });
    expect(key).toBeDefined();
    const [prov, ...m] = key!.split("/");
    const e = getPricingEntry({ provider: prov!, model: m.join("/") });
    expect(e).toBeDefined();
    expect(e?.pricingVersion).toBe("catalog-vendored");
    expect(e?.inputCostPerMillion).toBeGreaterThanOrEqual(0);
  });

  it("miss in BOTH sources still returns undefined (no fabricated zeros)", () => {
    expect(getPricingEntry({ provider: "nope", model: "not-a-model" })).toBeUndefined();
  });

  it("drift advisory: models in both files agree on per-1M rates", () => {
    const raw = JSON.parse(
      readFileSync(
        new URL("../../../src/internal/budget/pricing-data.json", import.meta.url),
        "utf-8",
      ),
    ) as { models: Record<string, { input: number; output: number }> };
    const deltas: string[] = [];
    for (const [key, lite] of Object.entries(raw.models)) {
      const cat = getCatalogModelInfo(key)?.cost;
      if (cat === undefined) continue;
      if (cat.input !== lite.input || cat.output !== lite.output) {
        deltas.push(
          `${key}: litellm ${lite.input}/${lite.output} vs catalog ${cat.input}/${cat.output}`,
        );
      }
    }
    // NOT advisory — this fails the build. A delta means the litellm snapshot and the provider
    // catalog disagree on a price, so one of the two is stale: re-run both refresh scripts and
    // commit the result. Calling a blocking assertion "advisory" is the expensive direction of the
    // mistake, because someone triaging a red build reads it and goes looking elsewhere.
    expect(deltas).toEqual([]);
  });
});
