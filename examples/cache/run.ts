/**
 * Semantic Cache demo (Adoption Roadmap #6; ADRs D249-D266).
 *
 * Shows:
 *   1. First query: miss → LLM called → cache.remember stores it
 *   2. Paraphrase: semantic hit (no LLM call needed via consult())
 *   3. Time-sensitive query: bypassed via exclude regex
 *   4. Stats summary
 *
 * Run:
 *   export OPENROUTER_API_KEY=sk-or-...
 *   pnpm install
 *   pnpm run run
 */

import { Agent, Cache } from "@theokit/sdk";

const OPENROUTER = process.env.OPENROUTER_API_KEY;
if (OPENROUTER === undefined || OPENROUTER.length === 0) {
  console.error("OPENROUTER_API_KEY missing — see .env.example");
  process.exit(1);
}

// A deterministic toy embedder for the demo (avoids spending OpenAI tokens
// on every prompt — production users plug a real EmbeddingRuntime here).
const toyEmbedder = {
  id: "toy-letter",
  model: "letter-bag-1",
  dimension: 26,
  async embed(texts: ReadonlyArray<string>): Promise<number[][]> {
    return texts.map((t) => {
      const v = new Array(26).fill(0);
      const norm = t.toLowerCase().replace(/[^a-z]/g, "");
      for (const ch of norm) {
        const i = ch.charCodeAt(0) - 97;
        if (i >= 0 && i < 26) v[i] += 1;
      }
      const sum = v.reduce((a, b) => a + b, 0) || 1;
      return v.map((x) => x / sum);
    });
  },
};

async function main(): Promise<void> {
  const cache = Cache.semantic({
    embedder: toyEmbedder,
    threshold: 0.4,
    ttl: {
      default: process.env.CACHE_TTL ?? "1h",
      exclude: /\b(weather|today|now|current|stock)\b/i,
    },
    namespace: "demo",
    modelId: "openai/gpt-4o-mini",
  });

  const agent = await Agent.create({
    apiKey: OPENROUTER,
    model: { id: "openai/gpt-4o-mini" },
    local: { cwd: process.cwd(), sandboxOptions: { enabled: false } as const },
    name: "demo-agent",
    plugins: [cache.asPlugin()],
  });

  console.log("\n=== Query 1: 'What is the capital of France?' (miss expected) ===");
  const t1 = Date.now();
  const m1 = await cache.consult("What is the capital of France?");
  if (m1.hit) {
    console.log("(unexpected hit)", m1.response.slice(0, 80));
  } else {
    const r1 = await agent.send("What is the capital of France? Answer in one short sentence.");
    const result1 = await r1.wait();
    const text = result1.status === "finished" ? (result1.result ?? "") : "";
    await cache.remember("What is the capital of France?", text);
    console.log("LLM:", text.slice(0, 200));
  }
  console.log("Elapsed:", Date.now() - t1, "ms");

  console.log("\n=== Query 2: 'Tell me the capital city of France' (semantic hit expected) ===");
  const t2 = Date.now();
  const m2 = await cache.consult("Tell me the capital city of France");
  if (m2.hit) {
    console.log("CACHE HIT (", m2.source, ", dist=", m2.distance, ")");
    console.log("Cached:", m2.response.slice(0, 200));
  } else {
    console.log("(unexpected miss)");
  }
  console.log("Elapsed:", Date.now() - t2, "ms");

  console.log("\n=== Query 3: 'What is the weather in SF today?' (excluded by regex) ===");
  const t3 = Date.now();
  const m3 = await cache.consult("What is the weather in SF today?");
  console.log("hit:", m3.hit, "(should always be false due to exclude regex)");
  console.log("Elapsed:", Date.now() - t3, "ms");

  const s = cache.stats();
  console.log("\n=== Stats ===");
  console.log(
    `entries=${s.entries} kvHits=${s.kvHits} semanticHits=${s.semanticHits} misses=${s.misses} excluded=${s.excluded} evicted=${s.evicted} embedderFailures=${s.embedderFailures}`,
  );

  await agent.dispose();
}

main().catch((err) => {
  console.error("cache demo failed:", err);
  process.exit(1);
});
