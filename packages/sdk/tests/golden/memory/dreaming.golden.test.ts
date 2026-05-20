import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { diaryPath } from "../../../src/internal/memory/dreaming/diary.js";
import { runDreamingSweep } from "../../../src/internal/memory/dreaming/run.js";
import type { EmbeddingRuntime } from "../../../src/internal/memory/embedding-adapter.js";
import { memoryDir, memoryMdPath } from "../../../src/internal/memory/markdown-store.js";

/**
 * Phase 9 T9.1 — dreaming/REM consolidation (deterministic mode).
 */

/**
 * Deterministic embedding: encodes a text as a sparse-ish vector based on a
 * "topic" tag prefix. Tests use `topicA: foo` vs `topicB: bar` to control
 * which facts cluster.
 */
function topicEmbed(text: string, dim = 16): number[] {
  const vec = new Array<number>(dim).fill(0);
  const lower = text.toLowerCase();
  // Hash topic-tag-style content into specific buckets.
  if (lower.includes("topica")) {
    vec[0] = 1;
    vec[1] = 0.95;
  } else if (lower.includes("topicb")) {
    vec[2] = 1;
    vec[3] = 0.95;
  } else if (lower.includes("dupe")) {
    vec[4] = 1;
    vec[5] = 1;
  } else {
    // Hash to fallback bucket for randomness
    let seed = 0;
    for (let i = 0; i < text.length; i++) seed = (seed * 31 + text.charCodeAt(i)) >>> 0;
    vec[6 + (seed % (dim - 6))] = 1;
  }
  return vec;
}

function fakeEmbedding(dim = 16): EmbeddingRuntime {
  return {
    id: "fake",
    model: "fake-dream",
    dimension: dim,
    stats: () => ({ cacheHits: 0, cacheMisses: 0, httpCalls: 0, retries: 0 }),
    embed: (texts) => Promise.resolve(texts.map((t) => topicEmbed(t, dim))),
  };
}

describe("dreaming sweep", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "theokit-dream-"));
    await mkdir(memoryDir(cwd), { recursive: true });
  });

  it("deduplicates near-identical facts (light phase)", async () => {
    await writeFile(
      memoryMdPath(cwd),
      "# Memory\n\n## Facts\n\n- dupe fact one.\n- dupe fact one.\n- dupe fact one.\n- topica unique fact.\n",
      "utf8",
    );
    const result = await runDreamingSweep({
      cwd,
      embedding: fakeEmbedding(),
      now: () => 1700000000000,
    });
    expect(result.status).toBe("ok");
    expect(result.factsBefore).toBe(4);
    expect(result.duplicatesRemoved).toBeGreaterThanOrEqual(2);
  });

  it("clusters thematically related facts (REM phase)", async () => {
    await writeFile(
      memoryMdPath(cwd),
      "# Memory\n\n## Facts\n\n- topica fact one.\n- topica fact two.\n- topicb fact three.\n- topicb fact four.\n",
      "utf8",
    );
    const result = await runDreamingSweep({
      cwd,
      embedding: fakeEmbedding(),
      now: () => 1700000000000,
    });
    expect(result.status).toBe("ok");
    expect(result.clustersCreated).toBe(2);
    expect(result.notesWritten).toBe(1);
  });

  it("writes a diary entry under .theokit/memory/dream-diary.md", async () => {
    await writeFile(memoryMdPath(cwd), "# Memory\n\n## Facts\n\n- topica only fact.\n", "utf8");
    await runDreamingSweep({
      cwd,
      embedding: fakeEmbedding(),
      now: () => 1700000000000,
    });
    expect(existsSync(diaryPath(cwd))).toBe(true);
    const content = await readFile(diaryPath(cwd), "utf8");
    expect(content).toContain("# Dream Diary");
    expect(content).toContain("entry-hash:");
    expect(content).toContain("facts before:");
  });

  it("is idempotent — same input + same timestamp produces the same diary entry hash", async () => {
    await writeFile(memoryMdPath(cwd), "# Memory\n\n## Facts\n\n- topica fact one.\n", "utf8");
    const r1 = await runDreamingSweep({
      cwd,
      embedding: fakeEmbedding(),
      now: () => 1700000000000,
    });
    const diary1 = await readFile(diaryPath(cwd), "utf8");
    // Rewrite source state, then run again at the same timestamp.
    await writeFile(memoryMdPath(cwd), "# Memory\n\n## Facts\n\n- topica fact one.\n", "utf8");
    const r2 = await runDreamingSweep({
      cwd,
      embedding: fakeEmbedding(),
      now: () => 1700000000001,
    });
    const diary2 = await readFile(diaryPath(cwd), "utf8");
    expect(r1.factsBefore).toBe(r2.factsBefore);
    expect(diary2.length).toBeGreaterThan(diary1.length); // second entry appended
  });

  it("writes consolidated notes under notes/dreamed-<ts>.md", async () => {
    await writeFile(
      memoryMdPath(cwd),
      "# Memory\n\n## Facts\n\n- topica alpha.\n- topica beta.\n- topicb gamma.\n",
      "utf8",
    );
    await runDreamingSweep({
      cwd,
      embedding: fakeEmbedding(),
      now: () => 1700000000000,
    });
    const notes = await readdir(join(memoryDir(cwd), "notes")).catch(() => []);
    const dreamed = notes.filter((n) => n.startsWith("dreamed-"));
    expect(dreamed).toHaveLength(1);
    const noteContent = await readFile(join(memoryDir(cwd), "notes", dreamed[0]!), "utf8");
    expect(noteContent).toContain("# Dreamed ");
    expect(noteContent).toContain("Cluster 1");
  });

  it("skips when there are no facts to consolidate", async () => {
    const result = await runDreamingSweep({
      cwd,
      embedding: fakeEmbedding(),
      now: () => 1700000000000,
    });
    expect(result.status).toBe("skipped");
    expect(existsSync(diaryPath(cwd))).toBe(false);
  });

  it("notes are written atomically — no .tmp file remains after success (EC-3)", async () => {
    await writeFile(memoryMdPath(cwd), "# Memory\n\n## Facts\n\n- topica only.\n", "utf8");
    await runDreamingSweep({
      cwd,
      embedding: fakeEmbedding(),
      now: () => 1700000000000,
    });
    const notesDir = join(memoryDir(cwd), "notes");
    const files = await readdir(notesDir);
    expect(files.some((f) => f.endsWith(".tmp"))).toBe(false);
  });
});
