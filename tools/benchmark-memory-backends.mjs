#!/usr/bin/env node
/**
 * Benchmark: compare `IndexManager.open({ backend: "sqlite-vec" | "lance" })`
 * across corpus sizes (1k / 10k / 100k synthetic facts).
 *
 * Output: markdown report with columns Backend | Size | addFact ops/s |
 * recall p50 (ms) | recall p95 (ms) | Disk (MB) + Hardware: header.
 *
 * Run:
 *   node tools/benchmark-memory-backends.mjs --size 1k
 *   node tools/benchmark-memory-backends.mjs --out .claude/knowledge-base/benchmarks/memory-backends-2026-05-31.md
 *
 * D5 + D12 — provides numerical evidence for "Lance wins above Nk
 * facts" rationale. If Lance does NOT win → amend D43 honestly.
 *
 * Hardware specs are auto-captured in report header (EC-8).
 *
 * @internal — not in npm tarball; bench-only.
 */

import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { arch, cpus, freemem, platform, release, tmpdir, totalmem } from "node:os";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = resolve(__dirname, "..");

const SIZES = { "1k": 1_000, "10k": 10_000, "100k": 100_000 };
const RECALL_QUERIES = 100; // p50/p95 sample size per backend×size

const FLAG_HANDLERS = {
  "--size": (val) => ({ sizes: val === "all" ? ["1k", "10k", "100k"] : [val] }),
  "--backend": (val) => ({ backends: val === "both" ? ["sqlite-vec", "lance"] : [val] }),
  "--out": (val) => ({ out: val }),
};

function parseArgs(argv) {
  const args = { sizes: ["1k", "10k", "100k"], backends: ["sqlite-vec", "lance"], out: null };
  for (let i = 0; i < argv.length; i++) {
    const handler = FLAG_HANDLERS[argv[i]];
    if (handler !== undefined) {
      Object.assign(args, handler(argv[i + 1]));
      i++;
    }
  }
  return args;
}

function hardwareSummary() {
  const c = cpus();
  return {
    cpu: c[0]?.model ?? "unknown",
    cores: c.length,
    memTotalGb: (totalmem() / 1024 ** 3).toFixed(1),
    memFreeGb: (freemem() / 1024 ** 3).toFixed(1),
    platform: `${platform()} ${arch()} ${release()}`,
    nodeVersion: process.version,
  };
}

/**
 * Deterministic hash-based embedder — bench tool MUST be reproducible
 * across runs, so we cannot depend on real LLM provider quotas.
 */
function makeMockEmbedder(dim) {
  return {
    id: `bench-mock-${dim}`,
    model: "bench",
    dimension: dim,
    async embed(texts) {
      return texts.map((text) => {
        const hash = createHash("sha256").update(text).digest();
        const v = new Array(dim);
        for (let i = 0; i < dim; i++) {
          v[i] = hash[i % hash.length] / 127.5 - 1;
        }
        const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
        return v.map((x) => x / (norm || 1));
      });
    },
    stats() {
      return { cacheHits: 0, cacheMisses: 0, httpCalls: 0, retries: 0 };
    },
  };
}

function dirSizeMb(dir) {
  try {
    const out = statSync(dir);
    if (!out.isDirectory()) return 0;
  } catch {
    return 0;
  }
  // Walk recursively.
  let total = 0;
  const stack = [dir];
  const fs = createRequire(import.meta.url)("node:fs");
  while (stack.length > 0) {
    const cur = stack.pop();
    try {
      const entries = fs.readdirSync(cur, { withFileTypes: true });
      for (const e of entries) {
        const p = join(cur, e.name);
        if (e.isDirectory()) stack.push(p);
        else total += fs.statSync(p).size;
      }
    } catch {
      // skip
    }
  }
  return Math.round((total / 1024 / 1024) * 10) / 10;
}

function percentile(samples, p) {
  if (samples.length === 0) return 0;
  const sorted = samples.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function benchSqliteSize(size) {
  const tmp = mkdtempSync(join(tmpdir(), `bench-sqlite-${size}-`));
  try {
    const dim = 64;
    const embedder = makeMockEmbedder(dim);
    // Import IndexManager from the internal path via tsx-transpiled source.
    // Run this script with `pnpm exec tsx tools/benchmark-memory-backends.mjs`
    // from packages/sdk/ working dir.
    const { IndexManager } = await import(
      `file://${resolve(WORKSPACE_ROOT, "packages/sdk/src/internal/memory/index-manager.js")}`
    );
    const idx = await IndexManager.open({ cwd: tmp, embedding: embedder });
    // Generate N synthetic markdown chunks via MEMORY.md write + sync.
    const memDir = join(tmp, ".theokit", "memory");
    mkdirSync(memDir, { recursive: true });
    const lines = [];
    for (let i = 0; i < size; i++) {
      lines.push(`## Fact ${i}\n\nSynthetic text content for fact number ${i}.\n`);
    }
    writeFileSync(join(memDir, "MEMORY.md"), lines.join("\n"));
    const addStart = performance.now();
    await idx.sync();
    const addElapsedMs = performance.now() - addStart;
    const addOpsPerSec = (size / addElapsedMs) * 1000;
    // Recall measurements.
    const recallSamples = [];
    for (let i = 0; i < RECALL_QUERIES; i++) {
      const q = `fact number ${Math.floor(Math.random() * size)}`;
      const s = performance.now();
      await idx.search(q, { maxResults: 5 });
      recallSamples.push(performance.now() - s);
    }
    const p50 = percentile(recallSamples, 50);
    const p95 = percentile(recallSamples, 95);
    const diskMb = dirSizeMb(memDir);
    idx.close();
    return { addOpsPerSec, p50, p95, diskMb };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

async function benchLanceSize(size) {
  const tmp = mkdtempSync(join(tmpdir(), `bench-lance-${size}-`));
  try {
    const dim = 64;
    const embedder = makeMockEmbedder(dim);
    const { LanceIndex } = await import(
      `file://${resolve(WORKSPACE_ROOT, "packages/sdk/src/internal/memory/lance-index.js")}`
    );
    // Direct LanceIndex for bench — avoids markdown corpus step.
    const lance = await LanceIndex.open({ cwd: tmp, embedding: embedder });
    // Generate N facts in batches of 500 to avoid memory spike.
    const BATCH = 500;
    const addStart = performance.now();
    for (let off = 0; off < size; off += BATCH) {
      const batch = [];
      const end = Math.min(off + BATCH, size);
      for (let i = off; i < end; i++) {
        batch.push({
          id: `f-${i}`,
          text: `Synthetic text content for fact number ${i}.`,
          source: "memory",
          namespace: "default",
          scope: "u",
          user_id: "bench",
          timestamp: i,
        });
      }
      await lance.addFacts(batch);
    }
    const addElapsedMs = performance.now() - addStart;
    const addOpsPerSec = (size / addElapsedMs) * 1000;
    const recallSamples = [];
    for (let i = 0; i < RECALL_QUERIES; i++) {
      const q = `fact number ${Math.floor(Math.random() * size)}`;
      const s = performance.now();
      await lance.search(q, { namespace: "default", limit: 5 });
      recallSamples.push(performance.now() - s);
    }
    const p50 = percentile(recallSamples, 50);
    const p95 = percentile(recallSamples, 95);
    const lanceDir = join(tmp, ".theokit", "memory", "lance");
    const diskMb = dirSizeMb(lanceDir);
    await lance.close();
    return { addOpsPerSec, p50, p95, diskMb };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

async function runSingleBench(backend, sizeKey, sizeN) {
  console.error(`Running ${backend} × ${sizeKey} (${sizeN} facts)...`);
  try {
    const r = backend === "lance" ? await benchLanceSize(sizeN) : await benchSqliteSize(sizeN);
    return { backend, size: sizeKey, ...r };
  } catch (err) {
    return {
      backend,
      size: sizeKey,
      addOpsPerSec: NaN,
      p50: NaN,
      p95: NaN,
      diskMb: NaN,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function resolveSize(sizeKey) {
  const sizeN = SIZES[sizeKey];
  if (sizeN === undefined) {
    console.error(`Unknown --size ${sizeKey}. Valid: ${Object.keys(SIZES).join(",")}`);
    process.exit(1);
  }
  return sizeN;
}

async function runBench(args) {
  const rows = [];
  for (const sizeKey of args.sizes) {
    const sizeN = resolveSize(sizeKey);
    for (const backend of args.backends) {
      rows.push(await runSingleBench(backend, sizeKey, sizeN));
    }
  }
  return { hw: hardwareSummary(), rows };
}

function renderMarkdown(report) {
  const { hw, rows } = report;
  const lines = [];
  lines.push(`# Memory backends benchmark — ${new Date().toISOString().slice(0, 10)}`);
  lines.push("");
  lines.push("> Generated by `tools/benchmark-memory-backends.mjs`.");
  lines.push("> Closes D12 + D43 rationale: numerical comparison between");
  lines.push('> `IndexManager.open({ backend: "sqlite-vec" })` (default) and');
  lines.push('> `IndexManager.open({ backend: "lance" })` (opt-in v1.4.0+).');
  lines.push("");
  lines.push("## Hardware");
  lines.push(`- **CPU:** ${hw.cpu} (${hw.cores} cores)`);
  lines.push(`- **Memory:** ${hw.memTotalGb} GB total, ${hw.memFreeGb} GB free at bench start`);
  lines.push(`- **Platform:** ${hw.platform}`);
  lines.push(`- **Node:** ${hw.nodeVersion}`);
  lines.push("");
  lines.push("## Methodology");
  lines.push("- Deterministic 64-dim hash-based mock embedder (reproducible).");
  lines.push("- SQLite path: writes synthetic markdown into `MEMORY.md`, runs `sync()`.");
  lines.push("- Lance path: writes facts directly via `LanceIndex.addFacts()` in batches of 500.");
  lines.push(`- Recall: ${RECALL_QUERIES} random queries per backend×size; p50/p95 in ms.`);
  lines.push("");
  lines.push("## Results");
  lines.push("");
  lines.push("| Backend | Size | addFact ops/s | recall p50 (ms) | recall p95 (ms) | Disk (MB) |");
  lines.push("|---|---|---:|---:|---:|---:|");
  for (const r of rows) {
    if (Number.isNaN(r.addOpsPerSec)) {
      lines.push(`| ${r.backend} | ${r.size} | ERROR | ERROR | ERROR | ERROR |`);
      lines.push(`| > error: ${r.error ?? "unknown"} |`);
      continue;
    }
    lines.push(
      `| ${r.backend} | ${r.size} | ${r.addOpsPerSec.toFixed(0)} | ${r.p50.toFixed(2)} | ${r.p95.toFixed(2)} | ${r.diskMb} |`,
    );
  }
  lines.push("");
  lines.push("## Interpretation");
  lines.push("");
  lines.push("Compare `recall p95` columns at the largest size:");
  lines.push("- If SQLite p95 > Lance p95 → Lance opt-in justified above that scale.");
  lines.push("- If similar → SQLite default covers your use case; skip the peer dep.");
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = await runBench(args);
  const md = renderMarkdown(report);
  if (args.out !== null) {
    mkdirSync(dirname(args.out), { recursive: true });
    writeFileSync(args.out, md);
    console.error(`Report written to ${args.out}`);
  } else {
    process.stdout.write(md);
  }
}

main().catch((err) => {
  console.error("FATAL:", err instanceof Error ? err.stack : err);
  process.exit(1);
});
