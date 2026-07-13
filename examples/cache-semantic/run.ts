/**
 * Cache — a semantic response cache. Store one answer, then serve it for a *similar* prompt without
 * another LLM call. Deterministic: uses the dependency-free lexical embedder (no network, no LLM).
 */
import assert from "node:assert/strict";
import { Cache, createLexicalEmbedder } from "@theokit/sdk-cache";

const cache = Cache.semantic({
  embedder: createLexicalEmbedder(), // dependency-free — no API calls
  threshold: 0.5,                     // cosine distance; higher = more lenient match
});

await cache.remember("How do I deploy the app?", "Run the `ship` command.");

const exact = await cache.consult("How do I deploy the app?");
const similar = await cache.consult("How do I deploy my application?");
const miss = await cache.consult("What is the capital of France?");

console.log("exact:  ", exact.hit ? `${exact.source} hit -> ${exact.response}` : "miss");
console.log("similar:", similar.hit ? `${similar.source} hit -> ${similar.response}` : "miss");
console.log("miss:   ", miss.hit ? "hit" : "miss");

const s = cache.stats();
console.log(`stats:   kvHits=${s.kvHits} semanticHits=${s.semanticHits} misses=${s.misses}`);

// --- validate output (assert) ---
assert.ok(exact.hit && exact.source === "kv");
assert.ok(similar.hit && similar.source === "semantic");
assert.equal(miss.hit, false);
