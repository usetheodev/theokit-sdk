#!/usr/bin/env node
/**
 * SDK 2.0 Stage 3 drift detector — compare sdk-core's internal/memory
 * files to sdk-memory's canonical copies + report behavioral
 * divergence.
 *
 * Stage 3 source-move shipped the hybrid dual-copy pattern (iter 44-75):
 * sdk-core retains internal/memory/* for v1.x back-compat; sdk-memory
 * ships the canonical copies. During the lifetime of Stage 4 routing,
 * both copies must stay byte-equivalent at runtime — if a maintainer
 * patches a bug in one but forgets the other, consumers routing
 * through sdk-memory see different behavior than legacy consumers.
 *
 * This tool walks sdk-memory's `internal/*.ts` files and matches each
 * to its sdk-core counterpart. For each pair:
 *   - Normalizes source (strips comments + leading import block since
 *     the import paths differ by package boundary)
 *   - Compares the normalized bodies
 *   - Reports mismatches as DRIFT findings
 *
 * Usage:
 *   node scripts/sdk-2-0-stage3-drift-detector.mjs
 *
 * Exit code:
 *   0 — no drift detected (or all known-divergent files are
 *       declared in the allowlist below)
 *   1 — drift detected; details printed
 *
 * Allowlist: files where divergence is INTENTIONAL (sdk-memory uses
 * public sub-paths instead of internal paths, inline-duplicate type
 * mirrors for rollup-dts treeshake, etc.) are declared in
 * KNOWN_DIVERGENCES below + skipped from comparison.
 *
 * Iter 93. Runs in dry-run; never modifies anything.
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";

const REPO_ROOT = new URL("..", import.meta.url).pathname;
const SDK_CORE_MEMORY = join(REPO_ROOT, "packages/sdk/src/internal/memory");
const SDK_MEMORY_INTERNAL = join(REPO_ROOT, "packages/sdk-memory/src/internal");

/**
 * Maps sdk-memory's `internal/<file>.ts` to sdk-core's relative path
 * under `internal/memory/`. When sdk-memory renamed a file during
 * Stage 3 (e.g., `dreaming-phases.ts` → `dreaming/phases.ts`), the
 * map records the canonical sdk-core location.
 */
const FILE_MAP = {
  "active-memory.ts": "active-memory.ts",
  "active-memory-cache.ts": "active-memory-cache.ts",
  "active-memory-types.ts": "active-memory-types.ts",
  "adapter-catalog.ts": "adapters/catalog.ts",
  "chunk-markdown.ts": "storage/chunk-markdown.ts",
  "circuit-breaker.ts": "circuit-breaker.ts",
  "deepinfra-embedding.ts": "adapters/deepinfra-embedding.ts",
  "dreaming-diary.ts": "dreaming/diary.ts",
  "dreaming-phases.ts": "dreaming/phases.ts",
  "dreaming-run.ts": "dreaming/run.ts",
  "embedding-adapter.ts": "embedding-adapter.ts",
  "embedding-cache.ts": "embedding-cache.ts",
  "index-db.ts": "index-db.ts",
  "index-manager.ts": "index-manager.ts",
  "index-manager-contract.ts": "index-manager-contract.ts",
  "index-manager-dispatch.ts": "index-manager-dispatch.ts",
  "index-schema.ts": "index-schema.ts",
  "lance-index.ts": "lance-index.ts",
  "lance-memory-adapter.ts": "lance-memory-adapter.ts",
  "markdown-store.ts": "storage/markdown-store.ts",
  "memory-index.ts": "memory-index.ts",
  "memory-types.ts": "types.ts",
  "migrate-sqlite-to-lance.ts": "migrate-sqlite-to-lance.ts",
  "migration.ts": "migration.ts",
  "mistral-embedding.ts": "adapters/mistral-embedding.ts",
  "ollama-embedding.ts": "adapters/ollama-embedding.ts",
  "openai-compatible.ts": "adapters/openai-compatible.ts",
  "openai-embedding.ts": "adapters/openai-embedding.ts",
  "openrouter-embedding.ts": "adapters/openrouter-embedding.ts",
  "reader.ts": "storage/reader.ts",
  "session-loader.ts": "storage/session-loader.ts",
  "session-summary-writer.ts": "storage/session-summary-writer.ts",
  "sqlite-vec-loader.ts": "sqlite-vec-loader.ts",
  "tools.ts": "tools.ts",
  "transcript-store.ts": "storage/transcript-store.ts",
  "vec-index.ts": "vec-index.ts",
  "voyage-embedding.ts": "adapters/voyage-embedding.ts",
  "wiki-loader.ts": "storage/wiki-loader.ts",
};

/**
 * Files where divergence is INTENTIONAL by design. Each entry
 * documents WHY the divergence exists.
 */
const KNOWN_DIVERGENCES = {
  "adapter-catalog.ts":
    "sdk-memory uses adapter-catalog.ts (renamed from catalog.ts) + drops the type annotation per iter 74 rollup-dts workaround.",
  "adapter-http-error.ts":
    "Inlined helper that doesn't exist in sdk-core — iter 73 inlined replacement for sdk-core's internal/errors/mappers/openai-compatible.ts.",
  "active-memory.ts":
    "sdk-memory inlines structural mirrors of OTelSpan + TelemetryHandle + 2 constant strings since sdk-core's internal/telemetry/ is not public (iter 75 workaround).",
  "chunk-markdown.ts":
    "sdk-memory inlines MemoryChunk mirror per iter 53 rollup-dts treeshake workaround.",
  "deepinfra-embedding.ts": "iter 74 drops the explicit type annotation per rollup-dts workaround.",
  "embedding-cache.ts":
    "sdk-memory keeps internal-only per iter 46 (no public consumer yet); sdk-core exposes it differently.",
  "in-memory-provider.ts":
    "sdk-memory-only file — provider that doesn't exist in sdk-core.",
  "index-manager.ts":
    "sdk-memory inlines 4 contract types per iter 72 rollup-dts treeshake workaround + uses sibling import for sanitizeFts5Query.",
  "lance-memory-adapter.ts":
    "sdk-memory inlines LanceIndex structural mirror per iter 69 rollup-dts treeshake workaround.",
  "memory-types.ts":
    "sdk-memory renames the file (types.ts → memory-types.ts) for explicit naming + wraps Security.redact since redactSecrets is not on sdk-core's public surface (iter 52 workaround).",
  "migrate-sqlite-to-lance.ts":
    "sdk-memory uses public errors path + sibling memory-types for redactSecrets.",
  "mistral-embedding.ts": "iter 74 rollup-dts workaround.",
  "ollama-embedding.ts": "iter 74 rollup-dts workaround.",
  "openai-compatible.ts":
    "Imports inlined adapter-http-error sibling (iter 73) instead of sdk-core's internal mapper.",
  "openai-embedding.ts": "iter 74 rollup-dts workaround.",
  "openrouter-embedding.ts": "iter 74 rollup-dts workaround.",
  "voyage-embedding.ts": "iter 74 rollup-dts workaround.",
  "reader.ts": "sdk-memory inlines MemoryReadResult mirror per iter 55 rollup-dts workaround.",
  "sqlite-vec-loader.ts": "sdk-memory inlines MemoryDb mirror per iter 66 rollup-dts workaround.",
  "vec-index.ts": "sdk-memory inlines MemoryDb mirror per iter 67 rollup-dts workaround.",
  "active-memory-types.ts":
    "sdk-memory inlines MemorySearchHit mirror per iter 48; replaced by canonical import in iter 50 — current state: canonical (no divergence).",
  "memory-index.ts":
    "sdk-memory drops the type re-export from sibling per iter 50 rollup-dts workaround.",
};

const findings = [];

function normalizeSource(source) {
  // Strip leading import block + the iter-X comment headers + leading
  // doc comment so we compare ONLY the runtime body.
  let s = source;
  // Strip block comments.
  s = s.replace(/\/\*[\s\S]*?\*\//g, "");
  // Strip line comments.
  s = s.replace(/\/\/.*$/gm, "");
  // Strip import statements (and trailing semicolons).
  s = s.replace(/^\s*import\b[^;]*;[\r\n]*/gm, "");
  s = s.replace(/^\s*import\b[^;]*$/gm, "");
  // Collapse whitespace.
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

async function fileExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function compare(memoryFile, coreFile) {
  const memoryPath = join(SDK_MEMORY_INTERNAL, memoryFile);
  const corePath = join(SDK_CORE_MEMORY, coreFile);

  if (!(await fileExists(corePath))) {
    findings.push({
      level: "MISSING_CORE",
      memoryFile,
      coreFile,
      detail: `sdk-core does not have ${coreFile}`,
    });
    return;
  }
  if (!(await fileExists(memoryPath))) {
    findings.push({
      level: "MISSING_MEMORY",
      memoryFile,
      coreFile,
      detail: `sdk-memory does not have ${memoryFile}`,
    });
    return;
  }

  const memorySrc = await readFile(memoryPath, "utf8");
  const coreSrc = await readFile(corePath, "utf8");
  const memoryNorm = normalizeSource(memorySrc);
  const coreNorm = normalizeSource(coreSrc);

  if (memoryNorm === coreNorm) {
    return; // identical post-normalization
  }

  if (KNOWN_DIVERGENCES[memoryFile] !== undefined) {
    return; // intentional divergence; allowlisted
  }

  findings.push({
    level: "DRIFT",
    memoryFile,
    coreFile,
    detail: `normalized bodies differ — review for drift (or add to KNOWN_DIVERGENCES with rationale)`,
  });
}

function printReport() {
  console.log("# SDK 2.0 Stage 3 drift detector");
  console.log("");
  const checked = Object.keys(FILE_MAP).length;
  console.log(`Pairs checked: ${checked}`);
  console.log(`Known divergences (allowlisted): ${Object.keys(KNOWN_DIVERGENCES).length}`);
  console.log(`Findings: ${findings.length}`);
  if (findings.length === 0) {
    console.log("\n## Result: PASS — no unexpected drift.");
    return;
  }

  console.log("\n## Result: FAIL — drift found.");
  const byLevel = new Map();
  for (const f of findings) {
    if (!byLevel.has(f.level)) byLevel.set(f.level, []);
    byLevel.get(f.level).push(f);
  }
  for (const [level, list] of byLevel.entries()) {
    console.log(`\n### ${level} (${list.length})`);
    for (const f of list) {
      console.log(`  ${f.memoryFile} ↔ ${f.coreFile}`);
      console.log(`    ${f.detail}`);
    }
  }
  console.log("\nMitigation:");
  console.log("  - If the divergence is intentional, add the file to KNOWN_DIVERGENCES");
  console.log("    with a one-line rationale.");
  console.log("  - If unintentional, sync the change to the missing copy.");
}

async function main() {
  for (const [memoryFile, coreFile] of Object.entries(FILE_MAP)) {
    await compare(memoryFile, coreFile);
  }
  printReport();
  process.exit(findings.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("drift detector failed:", err);
  process.exit(1);
});
