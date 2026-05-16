import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Memory } from "@usetheo/sdk";

/**
 * Switch among the 5 embedding adapters shipped in v1.0 (ADR D11):
 *   - openai
 *   - mistral
 *   - openrouter (proxies to any underlying model)
 *   - voyage
 *   - deepinfra
 *
 * The dreaming sweep runs identically for all 5 — the same code path,
 * just a different `provider` field. Auto-picks the first provider with
 * an env key present.
 */

type Provider = "openai" | "mistral" | "openrouter" | "voyage" | "deepinfra";

function pickProvider(): { provider: Provider; model?: string } {
  if (process.env.OPENAI_API_KEY) return { provider: "openai", model: "text-embedding-3-small" };
  if (process.env.MISTRAL_API_KEY) return { provider: "mistral" };
  if (process.env.OPENROUTER_API_KEY) {
    return { provider: "openrouter", model: "openai/text-embedding-3-small" };
  }
  if (process.env.VOYAGE_API_KEY) return { provider: "voyage" };
  if (process.env.DEEPINFRA_API_KEY) return { provider: "deepinfra" };
  throw new Error(
    "Set one of: OPENAI_API_KEY, MISTRAL_API_KEY, OPENROUTER_API_KEY, VOYAGE_API_KEY, DEEPINFRA_API_KEY in .env.",
  );
}

async function main(): Promise<void> {
  const cwd = await mkdtemp(join(tmpdir(), "theokit-embedding-providers-"));
  await mkdir(join(cwd, ".theokit", "memory"), { recursive: true });
  await writeFile(
    join(cwd, ".theokit", "memory", "MEMORY.md"),
    [
      "# Memory",
      "",
      "## Facts",
      "",
      "- The user prefers Vitest as the test runner.",
      "- Vitest is the testing framework.",
      "- Production deploys via `pnpm deploy:prod`.",
      "",
    ].join("\n"),
    "utf8",
  );

  const embedding = pickProvider();
  console.log(`Running dreaming sweep with provider: ${embedding.provider}`);
  if (embedding.model !== undefined) console.log(`  model: ${embedding.model}`);

  const result = await Memory.runDreamingSweep({ cwd, embedding });
  console.log("\nResult:", result);

  const diaryPath = join(cwd, ".theokit", "memory", "dream-diary.md");
  if (existsSync(diaryPath)) {
    console.log(
      `\n✓ dream-diary.md created. Switch the provider in .env to see other adapters produce different cluster shapes (each model has different embedding semantics).`,
    );
  }
}

main().catch((cause) => {
  console.error("embedding-providers failed:", cause);
  process.exit(1);
});
