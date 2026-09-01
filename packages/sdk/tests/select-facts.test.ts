import { describe, expect, it } from "vitest";

import type { MemoryFact } from "../src/internal/memory/types.js";
import {
  CHARS_PER_TOKEN,
  DEFAULT_MAX_TOKENS,
  selectFactsForInjection,
} from "../src/internal/runtime/memory-glue/select-facts.js";

const dated = (text: string, modified: string): MemoryFact => ({ text, modified });
const undated = (text: string): MemoryFact => ({ text });

describe("selectFactsForInjection", () => {
  it("returns everything when the store is under both caps", () => {
    const facts = [dated("a", "2026-01-01T00:00:00Z"), undated("b")];
    expect(selectFactsForInjection(facts)).toHaveLength(2);
  });

  it("caps the entry count", () => {
    const facts = Array.from({ length: 50 }, (_, i) =>
      dated(`fact ${i}`, `2026-01-${String((i % 28) + 1).padStart(2, "0")}T00:00:00Z`),
    );
    expect(selectFactsForInjection(facts, { maxEntries: 10 })).toHaveLength(10);
  });

  it("caps the byte budget", () => {
    const facts = Array.from({ length: 20 }, (_, i) =>
      dated("x".repeat(100), `2026-01-01T00:00:0${i % 10}Z`),
    );
    const picked = selectFactsForInjection(facts, { maxEntries: 100, maxBytes: 350 });
    expect(picked.length).toBe(3);
    expect(picked.reduce((n, f) => n + f.text.length, 0)).toBeLessThanOrEqual(350);
  });

  it("ranks dated facts most-recent first", () => {
    const facts = [
      dated("old", "2026-01-01T00:00:00Z"),
      dated("newest", "2026-06-01T00:00:00Z"),
      dated("middle", "2026-03-01T00:00:00Z"),
    ];
    const picked = selectFactsForInjection(facts, { maxEntries: 2, undatedShare: 0 });
    expect(picked.map((f) => f.text)).toEqual(["newest", "middle"]);
  });

  it("does not bury undated facts behind dated ones", () => {
    // The regression this guards: sorting with `?? ""` would place every undated fact after
    // every dated one, so a hand-written note never survives a full store.
    const facts = [
      ...Array.from({ length: 20 }, (_, i) =>
        dated(`dated ${i}`, `2026-06-${String(i + 1).padStart(2, "0")}T00:00:00Z`),
      ),
      undated("hand written"),
    ];
    const picked = selectFactsForInjection(facts, { maxEntries: 10 });
    expect(picked.map((f) => f.text)).toContain("hand written");
  });

  it("lets one bucket use the quota the other cannot fill", () => {
    const facts = Array.from({ length: 10 }, (_, i) =>
      dated(`d${i}`, `2026-06-0${i % 10}T00:00:00Z`),
    );
    // undatedShare reserves 5 slots, but there are no undated facts to fill them.
    expect(selectFactsForInjection(facts, { maxEntries: 10, undatedShare: 0.5 })).toHaveLength(10);
  });

  it("never returns the same fact twice", () => {
    const facts = [
      ...Array.from({ length: 6 }, (_, i) => dated(`d${i}`, `2026-06-0${i}T00:00:00Z`)),
      ...Array.from({ length: 6 }, (_, i) => undated(`u${i}`)),
    ];
    const picked = selectFactsForInjection(facts, { maxEntries: 10 });
    expect(new Set(picked.map((f) => f.text)).size).toBe(picked.length);
  });

  it("skips a single oversized fact rather than spending the whole budget on it", () => {
    const facts = [
      dated("x".repeat(5000), "2026-06-01T00:00:00Z"),
      dated("small", "2026-05-01T00:00:00Z"),
    ];
    const picked = selectFactsForInjection(facts, { maxEntries: 10, maxBytes: 1000 });
    expect(picked.map((f) => f.text)).toEqual(["small"]);
  });

  it("enforces the ceiling in the unit the contract states it in", () => {
    // The regression: the first version set the cap to 60 * 1024 chars because the contract's
    // 15,000-token budget had "60 KB" written next to it. That is 16,605 tokens — 11% over the
    // ceiling it claimed to enforce. A budget stated in tokens and enforced in bytes is not enforced.
    const facts = Array.from({ length: 200 }, (_, i) =>
      dated("z".repeat(4000), `2026-06-01T00:00:${String(i % 60).padStart(2, "0")}Z`),
    );
    const bytes = selectFactsForInjection(facts, { maxEntries: 1000 }).reduce(
      (n, f) => n + f.text.length,
      0,
    );
    expect(bytes / CHARS_PER_TOKEN).toBeLessThanOrEqual(DEFAULT_MAX_TOKENS);
  });

  it("surfaces the relevant fact over newer irrelevant ones — the T3 regression", () => {
    // Live measurement, 25-fact store, real model: with recency-only ranking the answering
    // fact was MISSED when oldest and RECALLED when newest. Recency is not relevance, and a
    // store only has to outgrow the cap once for that difference to decide the answer.
    const needle = dated(
      "The staging database rollback key is vega-abc123",
      "2026-01-01T00:00:00Z",
    );
    const noise = Array.from({ length: 24 }, (_, i) =>
      dated(
        `Internal note ${i}: the reporting job for module ${i} runs nightly.`,
        `2026-06-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
      ),
    );
    const picked = selectFactsForInjection([needle, ...noise], {
      maxEntries: 10,
      query: "What is the staging database rollback key?",
    });
    expect(picked).toContain(needle);
  });

  it("falls back to recency when no query is given", () => {
    const facts = [dated("older", "2026-01-01T00:00:00Z"), dated("newer", "2026-06-01T00:00:00Z")];
    expect(selectFactsForInjection(facts, { maxEntries: 1, undatedShare: 0 })[0]?.text).toBe(
      "newer",
    );
  });

  it("ranks corroborated facts above uncorroborated ones at equal relevance", () => {
    // The deterministic half of the confidence gate. Marking the block tells the model; ordering
    // does not need the model to read anything. Measured: marking alone changes nothing when the
    // uncorroborated fact is the only candidate, so ordering is what carries the guarantee when
    // there IS a choice.
    const once = {
      text: "Deploys to production use --skip-tests",
      modified: "2026-06-01T00:00:00Z",
      observations: 1,
    } as MemoryFact;
    const twice = {
      text: "Deploys to production require the full test suite",
      modified: "2026-01-01T00:00:00Z",
      observations: 3,
    } as MemoryFact;
    const picked = selectFactsForInjection([once, twice], {
      maxEntries: 1,
      undatedShare: 0,
      query: "What do deploys to production require?",
    });
    // `once` is newer AND ranks first on recency. Corroboration outranks both.
    expect(picked[0]).toBe(twice);
  });

  it("still recalls an uncorroborated fact when it is the only one", () => {
    // Confidence, not presence: ordering must never become exclusion, or the system's central
    // promise — a fact written once is there next session — stops holding.
    const only = { text: "The rollback key is vega-1", observations: 1 } as MemoryFact;
    expect(selectFactsForInjection([only], { query: "rollback key" })).toEqual([only]);
  });

  it("handles an empty store and degenerate caps", () => {
    expect(selectFactsForInjection([])).toEqual([]);
    expect(selectFactsForInjection([undated("a")], { maxEntries: 0 })).toEqual([]);
    expect(selectFactsForInjection([undated("a")], { maxBytes: 0 })).toEqual([]);
  });

  it("keeps injected size flat as the store grows — the bar this exists for", () => {
    const size = (n: number): number =>
      selectFactsForInjection(
        Array.from({ length: n }, (_, i) =>
          dated("y".repeat(200), `2026-06-01T00:00:${String(i % 60).padStart(2, "0")}Z`),
        ),
      ).reduce((acc, f) => acc + f.text.length, 0);
    // 10x and 100x the store, same injected bytes: sublinear, which is the whole point.
    expect(size(100)).toBe(size(10));
    expect(size(1000)).toBe(size(10));
  });
});
