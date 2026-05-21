/**
 * Ollama Local RAG — 100% local retrieval-augmented generation.
 *
 * Demonstrates:
 *   - Ollama embedding (`nomic-embed-text`) for semantic search via the
 *     SDK's public `Memory.runDreamingSweep` adapter shape.
 *   - Ollama chat (`llama3.2:3b`) for answer generation via `Agent.send`.
 *   - Zero remote API calls — pure local pipeline.
 *
 * Run:
 *   1. ollama serve
 *   2. ollama pull nomic-embed-text  (embedding, ~274 MB)
 *   3. ollama pull llama3.2:3b       (chat, ~1.9 GB)
 *   4. pnpm install && pnpm start
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Agent } from "@usetheo/sdk";

const OLLAMA_HOST = process.env.OLLAMA_HOST ?? "http://localhost:11434";
const CHAT_MODEL = process.env.OLLAMA_CHAT_MODEL ?? "ollama/llama3.2:3b";
const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL ?? "nomic-embed-text";
const TOP_K = 3;

const here = fileURLToPath(new URL(".", import.meta.url));
const DATA = resolve(here, "../data/docs.md");

/** Embed a single text via Ollama's OpenAI-compatible `/v1/embeddings`. */
async function embed(text: string): Promise<number[]> {
  const response = await fetch(`${OLLAMA_HOST}/v1/embeddings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, input: text }),
  });
  if (!response.ok) {
    throw new Error(`Ollama embed failed: HTTP ${response.status} ${await response.text()}`);
  }
  const body = (await response.json()) as { data: Array<{ embedding: number[] }> };
  return body.data[0]!.embedding;
}

/** Cosine similarity between two equal-length vectors. */
function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

function parseFacts(markdown: string): string[] {
  return markdown
    .split("\n")
    .filter((line) => line.startsWith("- "))
    .map((line) => line.replace(/^-\s+/, "").trim())
    .filter((line) => line.length > 0);
}

async function main(): Promise<void> {
  // 1) Load static corpus.
  const corpus = parseFacts(readFileSync(DATA, "utf-8"));
  console.log(`Indexing ${corpus.length} facts via ${EMBED_MODEL}...`);

  // 2) Embed every fact (sequential — Ollama is local, network-free).
  const factVectors: number[][] = [];
  for (const fact of corpus) {
    factVectors.push(await embed(fact));
  }
  console.log("Index ready.\n");

  // 3) Query.
  const question = process.argv[2] ?? "When was TypeScript first released?";
  console.log(`Question: ${question}\n`);

  const qVector = await embed(question);

  // 4) Cosine similarity ranking.
  const ranked = corpus
    .map((text, i) => ({ text, score: cosine(qVector, factVectors[i]!) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_K);

  console.log(`Top ${TOP_K} retrieved facts:`);
  for (const r of ranked) {
    console.log(`  [${r.score.toFixed(3)}] ${r.text}`);
  }
  console.log();

  // 5) Compose context-augmented prompt and ask the local chat model.
  const context = ranked.map((r) => `- ${r.text}`).join("\n");
  const agent = await Agent.create({
    apiKey: process.env.THEOKIT_API_KEY ?? "local",
    model: { id: CHAT_MODEL },
    local: { cwd: process.cwd() },
    systemPrompt:
      "Answer the user's question using ONLY the facts in the provided context. " +
      "Reply in one sentence. If the context doesn't contain the answer, say so.",
  });

  const prompt = `Context:\n${context}\n\nQuestion: ${question}`;
  const run = await agent.send(prompt);
  process.stdout.write("Answer: ");
  for await (const event of run.stream()) {
    if (event.type === "assistant") {
      for (const part of event.message.content) {
        if (part.type === "text") process.stdout.write(part.text);
      }
    }
  }
  await run.wait();
  console.log("\n");
}

main().catch((cause) => {
  console.error("ollama-local-rag failed:", cause instanceof Error ? cause.message : cause);
  process.exit(1);
});
