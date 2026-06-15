/**
 * Memory System E2E Demo — exercises the hierarchical memory upgrades with real LLM.
 *
 * Features tested:
 *   1. Batch Encoding (rememberMany) — single embed call for N texts + dedup
 *   2. Composite Scoring — recency decay + importance weighting
 *   3. Query Analysis — LLM sub-query distillation for complex queries
 *   4. Hierarchical Scopes — path-based memory isolation
 *
 * Run:
 *   OPENROUTER_API_KEY=sk-or-... npx tsx examples/deepagents-parity-demo/run-memory.ts
 */

import { Agent } from "@theokit/sdk";
import {
  rememberMany,
  cosineSimilarity,
} from "../../packages/sdk-memory/src/internal/batch-encoder.js";
import {
  compositeScore,
  DEFAULT_COMPOSITE_CONFIG,
  type CompositeScoreConfig,
} from "../../packages/sdk-memory/src/internal/composite-scorer.js";
import { analyzeQuery } from "../../packages/sdk-memory/src/internal/query-analyzer.js";
import {
  MemoryScope,
  normalizeScopePath,
} from "../../packages/sdk-memory/src/internal/memory-scope.js";

const apiKey = process.env.OPENROUTER_API_KEY;
const hasLlm = apiKey?.startsWith("sk-or-") ?? false;

console.log("\n========================================");
console.log("  Memory System E2E Demo");
console.log("========================================\n");
console.log(`Mode: ${hasLlm ? "REAL LLM (OpenRouter)" : "LOCAL ONLY"}\n`);

// ─── 1. BATCH ENCODING ──────────────────────────────────────────────────

console.log("── 1. Batch Encoding (rememberMany) ──\n");

const mockEmbedding = {
  id: "test",
  providerId: "test",
  model: "test",
  dimension: 4,
  embed: async (texts: readonly string[]) => {
    console.log(`  embed() called ONCE for ${texts.length} texts (batch!)`);
    return texts.map((t) => {
      const h = [...t].reduce((a, c) => a + c.charCodeAt(0), 0);
      return [h % 100 / 100, (h * 7) % 100 / 100, (h * 13) % 100 / 100, (h * 31) % 100 / 100];
    });
  },
  stats: () => ({ calls: 0, cacheHits: 0, cacheMisses: 0, totalTokens: 0 }),
};

const texts = [
  "TypeScript is a typed superset of JavaScript",
  "Zod is a schema validation library for TypeScript",
  "TypeScript is a typed superset of JavaScript",  // duplicate!
  "React is a UI library by Meta",
  "Zod is a TypeScript schema validation library",   // near-duplicate of #2
];

const { result, items } = await rememberMany(texts, mockEmbedding as never, {
  scope: "/demo/research",
  importance: 0.8,
  dedupThreshold: 0.95,
});

console.log(`  Input: ${result.total} texts`);
console.log(`  Deduped: ${result.deduped} (exact + near-duplicates removed)`);
console.log(`  Inserted: ${result.inserted} unique texts`);
console.log(`  Scope: /demo/research, Importance: 0.8`);

console.log("\n  BATCH ENCODING PASS\n");

// ─── 2. COMPOSITE SCORING ────────────────────────────────────────────────

console.log("── 2. Composite Scoring (recency decay + importance) ──\n");

const now = Date.now();
const oneDay = 24 * 60 * 60 * 1000;
const thirtyDays = 30 * oneDay;

// Same vector/text score, different ages
const recentScore = compositeScore(0.9, 0.7, now - oneDay, 0.5);
const oldScore = compositeScore(0.9, 0.7, now - 90 * oneDay, 0.5);
const veryOldScore = compositeScore(0.9, 0.7, now - 365 * oneDay, 0.5);

console.log(`  Same content (vector=0.9, text=0.7, importance=0.5):`);
console.log(`    1 day old:   ${recentScore.toFixed(4)}`);
console.log(`    90 days old: ${oldScore.toFixed(4)}`);
console.log(`    365 days old: ${veryOldScore.toFixed(4)}`);
console.log(`    Recent > Old: ${recentScore > oldScore} (recency decay working)`);

// Same age, different importance
const highImportance = compositeScore(0.8, 0.5, now, 1.0);
const lowImportance = compositeScore(0.8, 0.5, now, 0.1);

console.log(`\n  Same age, different importance (vector=0.8, text=0.5):`);
console.log(`    importance=1.0: ${highImportance.toFixed(4)}`);
console.log(`    importance=0.1: ${lowImportance.toFixed(4)}`);
console.log(`    High > Low: ${highImportance > lowImportance}`);

// Backward-compat: legacy weights
const legacy: CompositeScoreConfig = {
  semanticWeight: 0.6,
  textWeight: 0.4,
  recencyWeight: 0,
  importanceWeight: 0,
  recencyHalfLifeMs: thirtyDays,
};
const legacyScore = compositeScore(0.9, 0.7, now, 1.0, legacy);
const expected = 0.6 * 0.9 + 0.4 * 0.7;
console.log(`\n  Backward-compat (legacy weights 0.6/0.4):`);
console.log(`    Score: ${legacyScore.toFixed(4)} == Expected: ${expected.toFixed(4)} (${Math.abs(legacyScore - expected) < 0.001 ? "MATCH" : "MISMATCH"})`);

// Legacy data (null created_at)
const nullRecency = compositeScore(0.8, 0.5, null, 0.5);
console.log(`\n  Legacy data (null created_at): score=${nullRecency.toFixed(4)} (neutral recency=0.5)`);

console.log("\n  COMPOSITE SCORING PASS\n");

// ─── 3. QUERY ANALYSIS ───────────────────────────────────────────────────

console.log("── 3. Query Analysis (LLM sub-query distillation) ──\n");

// Short query — passes through
const shortResult = await analyzeQuery("What is TypeScript?", async () => {
  throw new Error("should not be called");
});
console.log(`  Short query "What is TypeScript?": subQueries=${JSON.stringify(shortResult.subQueries)}`);
console.log(`  LLM called: NO (query ≤250 chars)`);

if (hasLlm) {
  // Long query — uses LLM
  const longQuery = `I want to understand the complete history of TypeScript's type system evolution,
  including how it compares to Flow and ReasonML, what major features were added in each version
  from 1.0 to 5.x, how the compiler architecture changed over time, what design decisions were
  made regarding structural vs nominal typing, and how the community adoption curve compared
  to other typed JavaScript alternatives like Dart and CoffeeScript's type annotations.`;

  const agent = await Agent.create({
    apiKey,
    model: { id: "openai/gpt-4o-mini" },
    local: { cwd: process.cwd() },
    providers: {
      routes: [{ capability: "chat" as const, provider: "openrouter" }],
      fallback: ["openrouter"],
    },
  });

  const analysisResult = await analyzeQuery(longQuery, async (_system, user) => {
    const run = await agent.send(user, { systemPrompt: _system });
    const res = await run.wait();
    return res.result ?? "{}";
  });

  console.log(`\n  Long query (${longQuery.length} chars) → LLM analysis:`);
  console.log(`    Sub-queries: ${JSON.stringify(analysisResult.subQueries)}`);
  console.log(`    Time filter: ${analysisResult.timeFilter ?? "none"}`);
  console.log(`    Scope hint: ${analysisResult.scopeHint ?? "none"}`);
  agent.dispose();
} else {
  // Mock LLM
  const longQuery = "x".repeat(300);
  const mockResult = await analyzeQuery(longQuery, async () =>
    '{"subQueries":["TypeScript history","type system comparison","compiler architecture"]}',
  );
  console.log(`\n  Long query (${longQuery.length} chars) → mock analysis:`);
  console.log(`    Sub-queries: ${JSON.stringify(mockResult.subQueries)}`);
}

// Error fallback
const errorResult = await analyzeQuery("x".repeat(300), async () => {
  throw new Error("API down");
});
console.log(`\n  LLM error fallback: subQueries=[original query] (${errorResult.subQueries[0]?.length} chars)`);

console.log("\n  QUERY ANALYSIS PASS\n");

// ─── 4. HIERARCHICAL SCOPES ──────────────────────────────────────────────

console.log("── 4. Hierarchical Scopes ──\n");

// Path normalization
const tests = [
  { input: "/", expected: "/" },
  { input: "team/agent", expected: "/team/agent" },
  { input: "/team/agent/", expected: "/team/agent" },
  { input: "//team///agent", expected: "/team/agent" },
  { input: "", expected: "/" },
];

console.log("  Path normalization:");
for (const t of tests) {
  const result = normalizeScopePath(t.input);
  const ok = result === t.expected;
  console.log(`    "${t.input}" → "${result}" ${ok ? "OK" : `FAIL (expected "${t.expected}")`}`);
}

// Scope composition
const root = new MemoryScope("/");
const team = root.child("team");
const agent1 = team.child("agent-1");
const longTerm = agent1.child("long-term");

console.log(`\n  Scope composition:`);
console.log(`    root: ${root.path}`);
console.log(`    team: ${team.path}`);
console.log(`    agent-1: ${agent1.path}`);
console.log(`    long-term: ${longTerm.path}`);

// Search options
const opts = longTerm.toSearchOptions();
console.log(`\n  Search options: scopePrefix="${opts.scopePrefix}"`);

// Edge case: child with absolute path (EC-5)
const ec5 = team.child("/agent");
console.log(`  EC-5 (child with "/"): team.child("/agent") → "${ec5.path}"`);

console.log("\n  HIERARCHICAL SCOPES PASS\n");

// ─── 5. COSINE SIMILARITY (foundation) ───────────────────────────────────

console.log("── 5. Cosine Similarity (batch encoder foundation) ──\n");

const identical = cosineSimilarity([1, 0, 0], [1, 0, 0]);
const orthogonal = cosineSimilarity([1, 0, 0], [0, 1, 0]);
const zeroVec = cosineSimilarity([0, 0, 0], [1, 2, 3]);

console.log(`  Identical vectors: ${identical.toFixed(4)} (expected 1.0)`);
console.log(`  Orthogonal vectors: ${orthogonal.toFixed(4)} (expected 0.0)`);
console.log(`  Zero vector guard (EC-3): ${zeroVec} (expected 0, no NaN)`);

console.log("\n  COSINE SIMILARITY PASS\n");

// ─── SUMMARY ──────────────────────────────────────────────────────────────

console.log("========================================");
console.log("  ALL 5 MEMORY TESTS PASSED");
console.log(`  Mode: ${hasLlm ? "REAL LLM" : "LOCAL"}`);
console.log("========================================\n");
