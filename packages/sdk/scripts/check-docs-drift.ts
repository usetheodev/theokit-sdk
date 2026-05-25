#!/usr/bin/env tsx
/**
 * Cross-repo drift detection (v1 soft gate — ADR D14).
 *
 * Checks three things between `docs.md` / `dist/*.d.ts` / `examples/` of the
 * SDK and `content/theokit-sdk/` of the sibling `theo-opendocs` repo:
 *
 *  1. Every `## <Section>` in docs.md has a corresponding `concepts/<slug>.mdx`
 *     (via SECTION_TO_SLUG mapping, absorbs EC-6 false positive).
 *  2. Every public symbol in docs-json/api.json has a `reference/<symbol>.mdx`.
 *  3. Every example dir has a `cookbook/<example>.mdx` (or is in EXCLUDED).
 *
 * Exit code:
 *  - 0 — no drift
 *  - 1 — drift detected (WARNING in v1; v1.1 promotes to hard fail)
 *
 * Run via: pnpm docs:drift
 */

import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const DOCS_MD = path.join(ROOT, "sdk/docs.md");
const TYPEDOC_JSON = path.join(ROOT, "sdk/docs-json/api.json");
const EXAMPLES_DIR = path.join(ROOT, "../examples");
const OPENDOCS_DIR = path.resolve(ROOT, "../../theo-opendocs/content/theokit-sdk");

// EC-6: explicit mapping from docs.md `## ` heading lower-snake-first-segment
// to concepts/<slug>.mdx. New sections without an entry trigger a WARN
// (forces a human to either add the concept page or update the mapping).
const SECTION_TO_SLUG: Record<string, string> = {
  agent: "agent",
  tools: "tools",
  session: "sessions",
  streaming: "streaming",
  mcp: "mcp",
  hooks: "hooks",
  memory: "memory",
  cron: "cron",
  "eval suite": "eval",
  "agent handoffs": "handoffs",
  workflows: "workflows",
  "semantic cache": "cache",
  "slack gateway": "gateways",
  "bedrock provider": "providers-bedrock-vertex",
  "vertex ai provider": "providers-bedrock-vertex",
  "security — secret redaction": "security",
  "security — path traversal + toctou": "security",
  "built-in tools for coding agents": "tools",
  "configuration files": "configuration",
  "local models — ollama": "providers", // getting-started/providers
};

// Recipes generator already skips telegram-pro — drift should too.
const EXAMPLE_EXCLUDED = new Set<string>(["telegram-pro"]);

interface DriftReport {
  conceptsMissing: string[];
  conceptsUnmapped: string[];
  referenceMissing: string[];
  cookbookMissing: string[];
  warnings: string[];
}

function extractDocsMdSections(): { raw: string; key: string }[] {
  if (!fs.existsSync(DOCS_MD)) return [];
  const lines = fs.readFileSync(DOCS_MD, "utf8").split("\n");
  const out: { raw: string; key: string }[] = [];
  for (const ln of lines) {
    if (!ln.startsWith("## ")) continue;
    const raw = ln.slice(3).trim();
    // Key = lowercased + strip parens content + strip dash/em-dash tail beyond first segment
    let key = raw.toLowerCase();
    key = key.replace(/\s*\([^)]*\)\s*/g, "");
    // Try matching against full key first; if no map, try first-segment-only
    const segFirst = key.split(/—|–|-/)[0]!.trim();
    out.push({ raw, key: SECTION_TO_SLUG[key] !== undefined ? key : segFirst });
  }
  return out;
}

function checkConcepts(report: DriftReport): void {
  const sections = extractDocsMdSections();
  const conceptsDir = path.join(OPENDOCS_DIR, "concepts");
  if (!fs.existsSync(conceptsDir)) {
    report.warnings.push(`concepts/ missing entirely: ${conceptsDir}`);
    return;
  }
  const conceptFiles = new Set(
    fs
      .readdirSync(conceptsDir)
      .filter((f) => f.endsWith(".mdx") && !f.startsWith("_"))
      .map((f) => f.replace(/\.mdx$/, "")),
  );
  for (const { raw, key } of sections) {
    const slug = SECTION_TO_SLUG[key];
    if (slug === undefined) {
      report.conceptsUnmapped.push(`"${raw}" → key "${key}" (add to SECTION_TO_SLUG)`);
      continue;
    }
    if (!conceptFiles.has(slug)) {
      report.conceptsMissing.push(`docs.md "${raw}" expects concepts/${slug}.mdx (missing)`);
    }
  }
}

const INTERESTING_KINDS = new Set([128, 256, 2097152, 4194304, 64, 32]);

function collectInterestingSymbols(typedocJson: string): Set<string> {
  const json = JSON.parse(typedocJson) as {
    children?: Array<{ children?: Array<{ name: string; kind: number }> }>;
  };
  const symbols = new Set<string>();
  for (const mod of json.children ?? []) {
    for (const sym of mod.children ?? []) {
      if (INTERESTING_KINDS.has(sym.kind)) symbols.add(sym.name);
    }
  }
  return symbols;
}

function readRefFiles(refDir: string): Set<string> {
  return new Set(
    fs
      .readdirSync(refDir)
      .filter((f) => f.endsWith(".mdx") && !f.startsWith("_"))
      .map((f) => f.replace(/\.mdx$/, "")),
  );
}

function checkReference(report: DriftReport): void {
  if (!fs.existsSync(TYPEDOC_JSON)) {
    report.warnings.push(`typedoc JSON missing: ${TYPEDOC_JSON} (run \`pnpm docs:json\` first)`);
    return;
  }
  const symbolNames = collectInterestingSymbols(fs.readFileSync(TYPEDOC_JSON, "utf8"));
  const refDir = path.join(OPENDOCS_DIR, "reference");
  if (!fs.existsSync(refDir)) {
    report.warnings.push(`reference/ missing entirely`);
    return;
  }
  const refFiles = readRefFiles(refDir);
  for (const name of symbolNames) {
    const safe = name.replace(/[/\\:<>|?*]/g, "-");
    if (!refFiles.has(safe)) {
      report.referenceMissing.push(
        `symbol "${name}" missing reference/${safe}.mdx (run \`pnpm generate:sdk-reference\` in theo-opendocs)`,
      );
    }
  }
}

function isCookbookEligible(entryName: string): boolean {
  if (entryName.startsWith(".") || entryName === "node_modules") return false;
  if (EXAMPLE_EXCLUDED.has(entryName)) return false;
  return fs.existsSync(path.join(EXAMPLES_DIR, entryName, "README.md"));
}

function checkCookbook(report: DriftReport): void {
  if (!fs.existsSync(EXAMPLES_DIR)) {
    report.warnings.push(`examples/ missing`);
    return;
  }
  const cookDir = path.join(OPENDOCS_DIR, "cookbook");
  if (!fs.existsSync(cookDir)) {
    report.warnings.push(`cookbook/ missing entirely`);
    return;
  }
  const cookFiles = new Set(
    fs
      .readdirSync(cookDir)
      .filter((f) => f.endsWith(".mdx") && !f.startsWith("_"))
      .map((f) => f.replace(/\.mdx$/, "")),
  );
  for (const entry of fs.readdirSync(EXAMPLES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (!isCookbookEligible(entry.name)) continue;
    if (!cookFiles.has(entry.name)) {
      report.cookbookMissing.push(`example "${entry.name}" missing cookbook/${entry.name}.mdx`);
    }
  }
}

function printSection(title: string, items: ReadonlyArray<string>, limit?: number): void {
  if (items.length === 0) return;
  console.warn(`== ${title} ==`);
  const slice = limit !== undefined ? items.slice(0, limit) : items;
  for (const m of slice) console.warn("  -", m);
  if (limit !== undefined && items.length > limit) {
    console.warn(`  ... and ${items.length - limit} more`);
  }
  console.warn("");
}

function printReport(report: DriftReport): number {
  const total =
    report.conceptsMissing.length +
    report.conceptsUnmapped.length +
    report.referenceMissing.length +
    report.cookbookMissing.length;

  if (report.warnings.length > 0) {
    console.warn("[docs-drift] WARNINGS:");
    for (const w of report.warnings) console.warn("  -", w);
    console.warn("");
  }

  if (total === 0) {
    console.log(
      "[docs-drift] OK — no drift detected between docs.md / dist / examples and theo-opendocs/.",
    );
    return 0;
  }

  console.warn(`[docs-drift] ${total} drift entries detected (v1 SOFT gate — warning only):\n`);
  printSection("Concepts missing", report.conceptsMissing);
  printSection("Concepts unmapped (need entry in SECTION_TO_SLUG)", report.conceptsUnmapped);
  printSection(
    `Reference missing (${report.referenceMissing.length} symbols)`,
    report.referenceMissing,
    20,
  );
  printSection("Cookbook missing", report.cookbookMissing);
  return 1; // soft warning
}

function main(): void {
  const report: DriftReport = {
    conceptsMissing: [],
    conceptsUnmapped: [],
    referenceMissing: [],
    cookbookMissing: [],
    warnings: [],
  };
  checkConcepts(report);
  checkReference(report);
  checkCookbook(report);
  process.exit(printReport(report));
}

main();
