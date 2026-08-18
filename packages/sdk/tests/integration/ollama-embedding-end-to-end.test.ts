/**
 * Integration test for Ollama embedding adapter (T3.1, ADR D183).
 *
 * REQUIRES:
 *   - `ollama serve` running on http://localhost:11434 (override with OLLAMA_HOST)
 *   - `ollama pull nomic-embed-text` (override with OLLAMA_TEST_EMBED_MODEL)
 *
 * Skips silently when Ollama or the embedding model isn't available.
 * Per `.claude/rules/real-llm-validation.md`.
 */

import { describe, expect, it } from "vitest";
import { ollamaMemoryEmbeddingProviderAdapter } from "../../src/internal/memory/adapters/ollama-embedding.js";
import { OLLAMA_HOST, probeOllamaModel } from "./_ollama-probe.js";

const TEST_MODEL = process.env.OLLAMA_TEST_EMBED_MODEL ?? "nomic-embed-text";

const available =
  process.env.SKIP_OLLAMA_E2E !== "1" && (await probeOllamaModel(TEST_MODEL, OLLAMA_HOST));
if (!available) {
  process.stderr.write(
    `[ollama-embedding] Skipping — model "${TEST_MODEL}" not pulled. ` +
      `Run \`ollama pull ${TEST_MODEL}\` to enable.\n`,
  );
}

describe.skipIf(!available)("ollama embedding integration (D183)", () => {
  it("embeds a single text and returns a 768-dim vector", async () => {
    const runtime = await ollamaMemoryEmbeddingProviderAdapter.create({
      model: TEST_MODEL,
    });
    expect(runtime.dimension).toBe(768);

    const vectors = await runtime.embed(["hello world"]);
    expect(vectors).toHaveLength(1);
    expect(vectors[0]).toHaveLength(768);
    // Validate non-zero norm (cosine similarity would be NaN otherwise).
    const norm = Math.sqrt(vectors[0]!.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeGreaterThan(0);
  }, 60_000);

  it("embeds a batch of texts in order", async () => {
    const runtime = await ollamaMemoryEmbeddingProviderAdapter.create({
      model: TEST_MODEL,
    });

    const vectors = await runtime.embed([
      "dependency injection in TypeScript",
      "cosine similarity in vector retrieval",
      "ollama local llm runtime",
    ]);
    expect(vectors).toHaveLength(3);
    for (const v of vectors) {
      expect(v).toHaveLength(768);
    }
    // Adjacent queries about distinct topics should have meaningfully
    // different vectors — at least one component differs measurably.
    const diff = vectors[0]!.reduce((acc, x, i) => acc + Math.abs(x - vectors[1]![i]!), 0);
    expect(diff).toBeGreaterThan(0.01);
  }, 60_000);
});
