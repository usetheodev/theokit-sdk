/**
 * M94 Phase 2 — the context window declared on the definition reaches the budget.
 *
 * `resolveEffectiveContextWindow` has accepted `override` since M77, and the ONLY production call
 * site (`post-run-lifecycle.ts:149`) never passed it. With no catalog entry — OpenRouter has none —
 * the window stayed pinned to the floor (128k x 0.95 = 121,600) even on a 400k model: ~3x more
 * compaction than necessary, with extra summarizer calls and irreversible loss.
 *
 * ## Why a pure function instead of a shape gate
 *
 * The first version of this file asserted `const sel: ModelSelection = {contextWindow}` and passed —
 * vitest does not typecheck, so a nonexistent field fails nothing at runtime. The other three tests
 * exercised `resolveEffectiveContextWindow` directly, which already worked since M77. Four green
 * tests and **zero** detection power: the same class as M92 BLOCKER-1.
 *
 * `resolveWindowForRun` exists so that the WIRING is behavior: it is what the lifecycle calls, it
 * receives what the lifecycle holds, and a mutant that stops forwarding the override fails here.
 */
import { describe, expect, it } from "vitest";
import { ABSOLUTE_CONTEXT_WINDOW_CAP } from "../src/compaction.js";
import { getCatalogModelInfo } from "../src/internal/providers/catalog-loader.js";
import { resolveWindowForRun } from "../src/internal/runtime/lifecycle/post-run-lifecycle.js";

/** Real ids; the test requires at least ONE to have an entry, otherwise the clamp goes unproven. */
const CANDIDATE_MODELS = [
  "anthropic/claude-sonnet-4-5",
  "claude-sonnet-4-5",
  "openai/gpt-4o",
  "gpt-4o",
];

describe("M94 — resolveWindowForRun", () => {
  it("forwards the definition's contextWindow as an override", () => {
    // Model with no catalog entry (OpenRouter): before M94 this fell back to the 128k floor.
    const r = resolveWindowForRun("openrouter/model-of-400k", 400_000);
    expect(r.source).toBe("override");
    expect(r.window).toBeGreaterThan(300_000);
  });

  it("with no declared contextWindow, behavior is byte-identical to before", () => {
    const r = resolveWindowForRun("openrouter/unknown-model", undefined);
    expect(r.source).toBe("fallback");
    expect(r.window).toBe(Math.floor(128_000 * 0.95));
  });

  it("an inflated override IS clamped — the catalog's protection still holds", () => {
    // The guard must key off catalog PRESENCE, not off `source`: with an override present, `source`
    // is never "fallback" — the first draft of this test passed by accident because of that.
    const withCatalog = CANDIDATE_MODELS.find(
      (m) => getCatalogModelInfo(m)?.limit?.context !== undefined,
    );
    expect(withCatalog, "no catalog model available — the clamp would go unproven").toBeDefined();
    const catalogWindow = getCatalogModelInfo(withCatalog as string)?.limit?.context as number;
    const r = resolveWindowForRun(withCatalog as string, catalogWindow * 100);
    expect(r.clamped).toBe(true);
    expect(r.window).toBe(Math.floor(catalogWindow * 0.95));
  });

  it("a zero or negative contextWindow is ignored, not turned into a zero budget", () => {
    // Negative/zero as an override would produce a budget that triggers compaction every turn.
    expect(resolveWindowForRun("x/y", 0).source).toBe("fallback");
    expect(resolveWindowForRun("x/y", -1).source).toBe("fallback");
  });
});

describe("M95 — the clamp ALSO exists without a catalog (H2 from review)", () => {
  it("an absurd override with no catalog is bounded by the absolute cap", () => {
    // The scenario is one extra zero: `context_window = 4000000` instead of 400000. Before, with no
    // catalog entry, the value passed through whole and the agent never compacted until the provider
    // refused. Two extra zeros on 400k. One extra zero (4M) is plausible config and passes.
    const r = resolveWindowForRun("openrouter/no-catalog", 400_000_000);
    expect(r.clamped, "passed unbounded — silent fail-OPEN").toBe(true);
    expect(r.window).toBeLessThanOrEqual(ABSOLUTE_CONTEXT_WINDOW_CAP);
  });

  it("the real Llama 4 Scout window (10M) is NOT refused — it arrives via OpenRouter", () => {
    // The previous cap was 2M and would clamp this to 2M: a silent 80% loss of the declared window,
    // precisely on the catalog-less provider the cap exists to cover.
    const r = resolveWindowForRun("openrouter/llama-4-scout", 10_000_000);
    expect(r.clamped).toBe(false);
  });

  it("a plausible override with no catalog is NOT touched", () => {
    const r = resolveWindowForRun("openrouter/no-catalog", 400_000);
    expect(r.clamped).toBe(false);
    expect(r.window).toBe(Math.floor(400_000 * 0.95));
  });

  it("the catalog remains the preferred cap when it exists", () => {
    const withCatalog = CANDIDATE_MODELS.find(
      (m) => getCatalogModelInfo(m)?.limit?.context !== undefined,
    );
    const window = getCatalogModelInfo(withCatalog as string)?.limit?.context as number;
    const r = resolveWindowForRun(withCatalog as string, ABSOLUTE_CONTEXT_WINDOW_CAP - 1);
    expect(r.window).toBe(Math.floor(window * 0.95));
  });
});
