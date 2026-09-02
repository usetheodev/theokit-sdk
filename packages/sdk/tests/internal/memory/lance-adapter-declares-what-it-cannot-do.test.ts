/**
 * A backend that cannot walk a corpus must not answer like one that walked an empty corpus.
 *
 * `MemoryIndex` has exactly two implementers, and consumers hold the interface — the one place in
 * this package where Liskov is genuinely checkable rather than a matter of taste. The interface says
 * `sync()` *"walks the memory corpus + reindexes changed files"*. `IndexManager` does. Lance has no
 * corpus: it is a vector store fed by explicit `addFacts` calls.
 *
 * The adapter returned a frozen all-zeros `SyncResult`, and the comment above it stated the reason
 * as an intention — *"Returns zero counts so callers' existing logging (filesScanned: X) does not
 * break"*. That is the substitution defect written down as a feature: the substituted type is made
 * INDISTINGUISHABLE from a real sync over an empty corpus. `status()` had the same shape, hardcoding
 * `filesIndexed: 0, chunksIndexed: 0` while claiming `backend: "hybrid"`, so a caller deciding
 * "is the index populated?" from `chunksIndexed > 0` got a false negative on every Lance run no
 * matter how many rows the table held.
 *
 * Both now say which case they are in. The zeros are still zeros — the fix is not to invent counts,
 * it is to stop a caller reading them as a measurement that was taken.
 */
import { describe, expect, it } from "vitest";
import type { LanceIndex } from "../../../src/internal/memory/lance-index.js";
import { LanceMemoryAdapter } from "../../../src/internal/memory/lance-memory-adapter.js";

const stubInner = {
  async addFacts() {},
  async search() {
    return [];
  },
  async countFacts() {
    return 7;
  },
  async removeFacts() {},
  async close() {},
} as unknown as LanceIndex;

describe("LanceMemoryAdapter declares the operations it cannot perform", () => {
  it("sync() reports that it did not walk anything, not that it walked nothing", async () => {
    const result = await new LanceMemoryAdapter(stubInner).sync();
    expect(
      result.supported,
      "an all-zeros SyncResult is indistinguishable from a real sync over an empty corpus — the " +
        "flag is what separates 'nothing to do' from 'this backend has no corpus'",
    ).toBe(false);
    // The counts stay zero. Inventing numbers would trade one false claim for another.
    expect(result.filesScanned).toBe(0);
    expect(result.chunksWritten).toBe(0);
  });

  it("status() reports that its counts are not measured", () => {
    const status = new LanceMemoryAdapter(stubInner).status();
    expect(
      status.countsExact,
      "chunksIndexed: 0 on a table with rows in it is a false negative for any caller asking " +
        "'is the index populated?'",
    ).toBe(false);
    expect(status.backend).toBe("hybrid");
  });
});

/**
 * The file header claimed `search()` was vector-only — `textScore` undefined,
 * `vectorScore === score` — and had claimed it for as long as T4.5 (client-side
 * term overlap) had shipped. A second docblock ninety lines below described the
 * hybrid scoring correctly, so the two halves of one file disagreed and the
 * header is the half a caller reads.
 *
 * The header is prose and prose drifts. What stops it drifting again is this:
 * the scoring is now asserted, so a future edit that makes search() vector-only
 * fails here rather than making a comment true by accident.
 */
describe("LanceMemoryAdapter.search is hybrid, as the header now says", () => {
  const hit = {
    id: "f1",
    text: "typescript and functional programming",
    source: "memory" as const,
    score: 0.5,
  };
  const scoringInner = {
    async search() {
      return [hit];
    },
    async close() {},
  } as unknown as LanceIndex;

  it("adds a lexical term-overlap score to the vector distance", async () => {
    const [result] = await new LanceMemoryAdapter(scoringInner).search("typescript programming");

    expect(result?.vectorScore, "the vector distance passes through unchanged").toBe(0.5);
    expect(
      result?.textScore,
      "both query terms appear in the text, so overlap is 1 — not undefined, which is what " +
        "the header claimed",
    ).toBe(1);
    // 0.7 * 0.5 + 0.3 * 1
    expect(result?.score).toBeCloseTo(0.65, 10);
    expect(result?.score, "score === vectorScore is exactly the retired claim").not.toBe(
      result?.vectorScore,
    );
  });

  it("scores a query whose terms are absent at the vector distance alone", async () => {
    const [result] = await new LanceMemoryAdapter(scoringInner).search("kubernetes helm");

    expect(result?.textScore).toBe(0);
    // 0.7 * 0.5 + 0.3 * 0 — lexically absent, so below the overlapping query above.
    expect(result?.score).toBeCloseTo(0.35, 10);
  });
});
