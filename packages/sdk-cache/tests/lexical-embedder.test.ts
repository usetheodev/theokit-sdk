import { describe, expect, it } from "vitest";

import { Cache } from "../src/cache.js";
import { createLexicalEmbedder } from "../src/lexical-embedder.js";

/** L2 norm of a vector. */
function norm(v: number[]): number {
  return Math.sqrt(v.reduce((s, x) => s + x * x, 0));
}

describe("createLexicalEmbedder — shape + identity", () => {
  it("declares a stable id/model/dimension", () => {
    const e = createLexicalEmbedder(128);
    expect(e.id).toBe("theokit-lexical-v1-d128");
    expect(e.model).toBe("theokit-lexical-hash");
    expect(e.dimension).toBe(128);
  });

  it("defaults to dimension 256", () => {
    expect(createLexicalEmbedder().dimension).toBe(256);
  });

  it("returns one dimension-length vector per input text", async () => {
    const e = createLexicalEmbedder(64);
    const vecs = await e.embed(["alpha beta", "gamma"]);
    expect(vecs.length).toBe(2);
    expect(vecs[0]?.length).toBe(64);
    expect(vecs[1]?.length).toBe(64);
  });
});

describe("createLexicalEmbedder — vector math", () => {
  it("L2-normalizes non-empty vectors (unit length)", async () => {
    const e = createLexicalEmbedder(256);
    const [v] = await e.embed(["the quick brown fox jumps"]);
    expect(v).toBeDefined();
    expect(norm(v as number[])).toBeCloseTo(1, 6);
  });

  it("maps empty / whitespace text to a zero vector", async () => {
    const e = createLexicalEmbedder(32);
    const [empty, ws] = await e.embed(["", "   "]);
    expect(norm(empty as number[])).toBe(0);
    expect(norm(ws as number[])).toBe(0);
  });

  it("is deterministic — identical text yields identical vectors", async () => {
    const e = createLexicalEmbedder(128);
    const [a] = await e.embed(["repeat me exactly"]);
    const [b] = await e.embed(["repeat me exactly"]);
    expect(a).toEqual(b);
  });

  it("different text yields different vectors", async () => {
    const e = createLexicalEmbedder(256);
    const [a] = await e.embed(["completely different words here"]);
    const [b] = await e.embed(["unrelated tokens entirely now"]);
    expect(a).not.toEqual(b);
  });
});

describe("createLexicalEmbedder — usable with Cache.semantic", () => {
  it("is accepted as a CacheEmbedderRuntime", () => {
    expect(() => Cache.semantic({ embedder: createLexicalEmbedder() })).not.toThrow();
  });
});

describe("sdk-cache barrel — lexical embedder", () => {
  it("re-exports createLexicalEmbedder", async () => {
    const mod = await import("../src/index.js");
    expect(typeof mod.createLexicalEmbedder).toBe("function");
  });
});
