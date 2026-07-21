/**
 * SE41 — `Scorers.embeddingSimilarity`: cosine similarity of output vs expected
 * embeddings. Deterministic unit tests inject a fake `embed` (DIP); a gated
 * block exercises the real OpenRouter embeddings endpoint when a key is present.
 */

import { describe, expect, it } from "vitest";

import { Scorers } from "../../src/scorers.js";
import { resolveRealLlmEnv } from "../integration/real-llm/_helpers/real-llm-env.js";

/** Fixed vectors keyed by text — lets us assert exact cosine outcomes. */
const VECTORS: Record<string, number[]> = {
  same: [1, 0, 0],
  same2: [2, 0, 0], // parallel to `same` => cosine 1
  ortho: [0, 1, 0], // orthogonal => cosine 0
  opposite: [-1, 0, 0], // cosine -1 => clamped to 0
};

const fakeEmbed = (texts: readonly string[]): Promise<number[][]> =>
  Promise.resolve(texts.map((t) => VECTORS[t] ?? [0, 0, 0]));

describe("Scorers.embeddingSimilarity (SE41, injected embed)", () => {
  it("parallel vectors => cosine 1", async () => {
    const s = Scorers.embeddingSimilarity({ embed: fakeEmbed });
    expect((await s.score("same", "same2")).score).toBeCloseTo(1, 6);
  });

  it("orthogonal vectors => 0", async () => {
    const s = Scorers.embeddingSimilarity({ embed: fakeEmbed });
    expect((await s.score("same", "ortho")).score).toBeCloseTo(0, 6);
  });

  it("opposite vectors clamp to 0 (never negative)", async () => {
    const s = Scorers.embeddingSimilarity({ embed: fakeEmbed });
    expect((await s.score("same", "opposite")).score).toBe(0);
  });

  it("threshold binarizes", async () => {
    const pass = Scorers.embeddingSimilarity({ embed: fakeEmbed, threshold: 0.9 });
    expect((await pass.score("same", "same2")).score).toBe(1);
    const fail = Scorers.embeddingSimilarity({ embed: fakeEmbed, threshold: 0.9 });
    expect((await fail.score("same", "ortho")).score).toBe(0);
  });

  it("refuses non-string expected", async () => {
    const s = Scorers.embeddingSimilarity({ embed: fakeEmbed });
    expect((await s.score("same", 42)).reason).toBe("expected_not_string");
  });
});

const live = resolveRealLlmEnv("openrouter");

describe.skipIf(live.shouldSkip)("Scorers.embeddingSimilarity (real OpenRouter embeddings)", () => {
  it("scores a semantically-close pair higher than a distant pair", async () => {
    const s = Scorers.embeddingSimilarity({ apiKey: live.apiKey });
    const near = await s.score("the cat sat on the mat", "a cat is resting on a rug");
    const far = await s.score("the cat sat on the mat", "quantum chromodynamics lecture notes");
    expect(near.score).toBeGreaterThan(far.score);
    expect(near.score).toBeGreaterThanOrEqual(0);
    expect(near.score).toBeLessThanOrEqual(1);
  }, 30_000);
});
