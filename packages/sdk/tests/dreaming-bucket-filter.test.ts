import { describe, expect, it } from "vitest";

import { lightPhase } from "../src/internal/memory/dreaming/phases.js";
import type { MemoryFact } from "../src/internal/memory/types.js";

/**
 * ADR-14: atomic kinds are never merged. A sweep that deletes nothing still violates it when
 * deduplication runs across the whole store, because the cluster representative is what the
 * search index returns — the source survives and the read artefact conflates.
 */

/** Deterministic stand-in: identical text embeds identically, so near-duplicates collide. */
const embedding = {
  embed: (texts: readonly string[]): Promise<number[][]> =>
    Promise.resolve(
      texts.map((t) => {
        const v = [0, 0, 0];
        for (const ch of t) v[ch.charCodeAt(0) % 3] = (v[ch.charCodeAt(0) % 3] ?? 0) + 1;
        const n = Math.hypot(...v) || 1;
        return v.map((x) => x / n);
      }),
    ),
} as never;

const fact = (text: string, kind?: string): MemoryFact =>
  ({ text, ...(kind === undefined ? {} : { kind }) }) as MemoryFact;

describe("dreaming dedup respects the ADR-14 buckets", () => {
  it("never drops one of two near-identical feedback entries", async () => {
    // Two corrections a user gave on different days. They read alike. They are not the same
    // correction, and losing either from the clustering input loses what the user said.
    const a = fact("Do not use force push on the release branch", "feedback");
    const b = fact("Do not use force push on the release branch.", "feedback");
    const { kept, duplicatesRemoved } = await lightPhase([a, b], embedding);
    expect(kept).toContain(a);
    expect(kept).toContain(b);
    expect(duplicatesRemoved).toBe(0);
  });

  it("protects user and reference kinds the same way", async () => {
    const facts = [
      fact("The user prefers metric units", "user"),
      fact("The user prefers metric units.", "user"),
      fact("Architecture doc: https://example.invalid/a", "reference"),
      fact("Architecture doc: https://example.invalid/a.", "reference"),
    ];
    const { kept } = await lightPhase(facts, embedding);
    expect(kept).toHaveLength(4);
  });

  it("collapses untyped facts only on EXACT match, never on similarity", async () => {
    // Untyped is the common case, not an edge one: hand-written bullets under `## Facts` carry
    // no kind and the store's header invites editing them. Treating them as atomic would
    // disable the sweep for most stores; treating them as consolidatable would let a
    // near-duplicate of an untyped correction be dropped. Identity is the only claim the store
    // can make about them without inferring a kind.
    const identical = [
      fact("hand written note about billing"),
      fact("Hand written note about billing."), // same text, different case and trailing stop
    ];
    expect((await lightPhase(identical, embedding)).kept).toHaveLength(1);

    const merelySimilar = [
      fact("Do not deploy on Friday afternoons"),
      fact("Do not deploy on Friday mornings"),
    ];
    // Two different instructions that a 0.95 cosine would happily collapse.
    expect((await lightPhase(merelySimilar, embedding)).kept).toHaveLength(2);
  });

  it("still deduplicates the consolidatable bucket", async () => {
    const facts = [
      fact("The billing module lives in packages/billing", "project"),
      fact("The billing module lives in packages/billing", "project"),
    ];
    const { kept, duplicatesRemoved } = await lightPhase(facts, embedding);
    expect(kept).toHaveLength(1);
    expect(duplicatesRemoved).toBe(1);
  });

  it("keeps protected facts when mixed with consolidatable duplicates", async () => {
    const feedback = fact("Never deploy on Fridays", "feedback");
    const facts = [
      feedback,
      fact("Never deploy on Fridays", "feedback"),
      fact("Service runs on port 8080", "project"),
      fact("Service runs on port 8080", "project"),
    ];
    const { kept } = await lightPhase(facts, embedding);
    expect(kept.filter((f) => f.kind === "feedback")).toHaveLength(2);
    expect(kept.filter((f) => f.kind === "project")).toHaveLength(1);
  });
});
