import { ConfigurationError, migrateSqliteToLance } from "@usetheo/sdk";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Memory LanceDB backend + Migration CLI example (ADR D43, D44).
 *
 * SDK Memory persists facts in `.theokit/memory/MEMORY.md` (markdown-first
 * source of truth) plus an index for hybrid FTS5 + vector search. The
 * index has two backends:
 *   - "sqlite-vec" (default): SQLite + sqlite-vec extension. Built-in.
 *   - "lance" (opt-in, v1.2+): @lancedb/lancedb, columnar vector format
 *     designed for >100k facts.
 *
 * This example:
 *   1. Creates a fresh workspace in tmpdir.
 *   2. Seeds a couple of facts directly in .theokit/memory/MEMORY.md
 *      (the markdown-first source of truth — same path SDK uses).
 *   3. Runs `migrateSqliteToLance({ cwd, dryRun: true })` which works
 *      WITHOUT @lancedb/lancedb installed (read-only SQLite scan +
 *      placeholder validation).
 *   4. Tries to actually open the Lance backend — gracefully degrades
 *      with a friendly message if the module isn't installed.
 *
 * Always exits 0 regardless of whether Lance is installed (ADR D50).
 */

const cwd = mkdtempSync(join(tmpdir(), "memory-lance-demo-"));
console.log(`Workspace: ${cwd}\n`);

// Step 1: seed facts directly into the markdown source of truth.
// The SDK reads from .theokit/memory/MEMORY.md as authoritative; the
// SQLite/Lance index is a search accelerator built from this file.
const memoryDir = join(cwd, ".theokit", "memory");
mkdirSync(memoryDir, { recursive: true });
writeFileSync(
  join(memoryDir, "MEMORY.md"),
  `# Memory

- My favorite color is blue.
- I work as a software engineer.
- I live in São Paulo.
- My birthday is on March 15th.
- I prefer typescript over javascript.
`,
  "utf8",
);
console.log("Seeded 5 facts in .theokit/memory/MEMORY.md (the markdown source of truth).\n");

// Step 2: dry-run migration. ALWAYS works (no Lance dep required for dry-run).
console.log("Running migrateSqliteToLance({ dryRun: true }) ...");
const dryRun = await migrateSqliteToLance({
  cwd,
  dryRun: true,
  logger: (m) => console.log("  ", m),
});
console.log(
  `\nDry-run result: countSqlite=${dryRun.countSqlite}, countLance=${dryRun.countLance}, validated=${dryRun.validated}, committed=${dryRun.committed}`,
);
console.log(
  "\n(Note: the SQLite index is built lazily on first agent.send / memory_search. With zero facts indexed yet, countSqlite=0 is expected. Run an agent that uses memory_search to populate the index, then re-run migration.)\n",
);

// Step 3: document the Lance backend opt-in config + ConfigurationError shape.
// LanceIndex is an INTERNAL class; users opt-in via AgentOptions.memory.index.backend.
console.log("Memory + Lance opt-in config (set backend: 'lance' in AgentOptions.memory.index):");
console.log(
  JSON.stringify(
    {
      apiKey: "<your-key>",
      model: { id: "google/gemini-2.0-flash-001" },
      local: { cwd },
      memory: {
        enabled: true,
        namespace: "demo",
        userId: "demo-user",
        scope: "user",
        index: {
          backend: "lance",
          embedding: { provider: "openai", model: "text-embedding-3-small" },
        },
      },
    },
    null,
    2,
  ),
);
console.log(
  "\nWithout `@lancedb/lancedb` installed, the first memory_search call raises ConfigurationError(code: 'lance_backend_unavailable'):",
);
console.log("  pnpm add @lancedb/lancedb");
// Demonstrate the ConfigurationError shape so devs know what to catch:
const sampleError = new ConfigurationError(
  "Lance backend unavailable — install @lancedb/lancedb",
  { code: "lance_backend_unavailable" },
);
console.log(
  `\nSample typed error: { name: "${sampleError.name}", code: "${sampleError.code}", isRetryable: ${sampleError.isRetryable} }`,
);
console.log(
  `Catch with: if (err instanceof ConfigurationError && err.code === "lance_backend_unavailable") { ... }`,
);

console.log("\nDone. Workspace preserved at:", cwd);
console.log("Inspect: ls", cwd + "/.theokit/memory");
process.exit(0);
