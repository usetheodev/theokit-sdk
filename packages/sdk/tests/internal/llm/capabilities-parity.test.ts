import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it } from "vitest";

import { resolveModelCapabilities } from "../../../src/internal/llm/model-capabilities.js";
import { _resetModelInfoIndexForTests } from "../../../src/internal/providers/catalog-loader.js";

/**
 * M44 T1.1 — the EXACT map migrated into the catalog and died. PARITY: every former EXACT key returns
 * IDENTICAL ModelCapabilities through the catalog-backed resolver (fixture = snapshot of the old map,
 * dumped before deletion). Defaults + prefix/variant stripping unchanged.
 */

const snapshot = JSON.parse(
  readFileSync(new URL("../../fixtures/exact-map-snapshot.json", import.meta.url), "utf-8"),
) as Record<string, ReturnType<typeof resolveModelCapabilities>>;

beforeEach(() => _resetModelInfoIndexForTests());

describe("M44 — capabilities parity (EXACT map → catalog)", () => {
  it("every former EXACT key returns identical ModelCapabilities", () => {
    const diffs: string[] = [];
    for (const [key, expected] of Object.entries(snapshot)) {
      if (key.endsWith("/")) continue; // prefix-strip rules, not models
      const got = resolveModelCapabilities(key);
      if (JSON.stringify(got) !== JSON.stringify(expected)) {
        diffs.push(`${key}: got ${JSON.stringify(got)} want ${JSON.stringify(expected)}`);
      }
    }
    expect(diffs).toEqual([]);
  });

  it("unknown model still returns conservative defaults", () => {
    const caps = resolveModelCapabilities("totally/unknown-model-xyz");
    expect(caps.supportsToolUse).toBe(false);
    expect(caps.maxContextTokens).toBe(4096);
  });

  it("prefix + variant stripping unchanged (openrouter/x:free, vertex routing)", () => {
    // openrouter/anthropic/claude-3.5-sonnet:free → strips openrouter/ + :free → anthropic/claude-3.5-sonnet
    const viaRouted = resolveModelCapabilities("openrouter/anthropic/claude-3.5-sonnet:free");
    const direct = resolveModelCapabilities("anthropic/claude-3.5-sonnet");
    expect(viaRouted).toEqual(direct);
    // vendor inference: bare claude model infers anthropic/
    const inferred = resolveModelCapabilities("vertex/claude-opus-4");
    const directOpus = resolveModelCapabilities("anthropic/claude-opus-4");
    expect(inferred).toEqual(directOpus);
  });
});
