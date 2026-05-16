import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Memory } from "@usetheo/sdk";

/**
 * Demonstrates dreaming/REM consolidation:
 *   1. light — dedup near-duplicate facts via cosine similarity.
 *   2. REM   — cluster thematically related facts.
 *   3. deep  — write a consolidated `notes/dreamed-<ts>.md` + append to
 *              `dream-diary.md`.
 *
 * Requires a real embedding provider. Set `OPENAI_API_KEY` or
 * `MISTRAL_API_KEY` in `.env`.
 */

function pickProvider(): { provider: "openai" | "mistral" | "openrouter"; model?: string } {
  if (process.env.OPENAI_API_KEY) return { provider: "openai", model: "text-embedding-3-small" };
  if (process.env.MISTRAL_API_KEY) return { provider: "mistral" };
  if (process.env.OPENROUTER_API_KEY) {
    return { provider: "openrouter", model: "openai/text-embedding-3-small" };
  }
  throw new Error(
    "memory-dreaming requires OPENAI_API_KEY, MISTRAL_API_KEY, or OPENROUTER_API_KEY in .env — dreaming relies on real semantic embeddings.",
  );
}

async function main(): Promise<void> {
  const cwd = await mkdtemp(join(tmpdir(), "theokit-dream-"));
  await mkdir(join(cwd, ".theokit", "memory"), { recursive: true });
  await writeFile(
    join(cwd, ".theokit", "memory", "MEMORY.md"),
    [
      "# Memory",
      "",
      "## Facts",
      "",
      "- The user prefers Vitest as the test runner.",
      "- User uses Vitest for testing.",
      "- Test runner of choice is Vitest.",
      "- Production deploys go through `pnpm deploy:prod`.",
      "- Rollback is `pnpm rollback`.",
      "- The Slack channel for incidents is #ops-alerts.",
      "",
    ].join("\n"),
    "utf8",
  );

  const embedding = pickProvider();
  console.log(`Running dreaming sweep with embedding provider: ${embedding.provider}`);

  const result = await Memory.runDreamingSweep({ cwd, embedding });
  console.log("Result:", result);

  const diaryPath = join(cwd, ".theokit", "memory", "dream-diary.md");
  if (existsSync(diaryPath)) {
    const diary = await readFile(diaryPath, "utf8");
    console.log("\n=== dream-diary.md ===\n");
    console.log(diary);
  }

  const notesDir = join(cwd, ".theokit", "memory", "notes");
  if (existsSync(notesDir)) {
    const files = await readdir(notesDir);
    const dreamed = files.filter((f) => f.startsWith("dreamed-"));
    console.log(`\nDreamed notes written: ${dreamed.length}`);
    for (const f of dreamed) {
      console.log(`\n=== ${f} ===\n`);
      console.log(await readFile(join(notesDir, f), "utf8"));
    }
  }
}

main().catch((cause) => {
  console.error("memory-dreaming failed:", cause);
  process.exit(1);
});
