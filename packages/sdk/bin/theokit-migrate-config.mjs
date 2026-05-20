#!/usr/bin/env node

// CLI for markdown config migration (ADR D78).
// Converts legacy .theokit/hooks.json + .theokit/context.json +
// .theokit/plugins/<name>/plugin.json to the markdown + YAML frontmatter
// format (ADR D74).
//
// Usage: theokit-migrate-config [--cwd <path>] [--apply] [--no-backup] [--help]

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: arg parser keeps the if/else chain inline for clarity (tiny CLI)
function parseArgs(argv) {
  const args = {
    cwd: process.cwd(),
    apply: false,
    backup: true,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--cwd") args.cwd = argv[++i] ?? args.cwd;
    else if (a === "--apply") args.apply = true;
    else if (a === "--no-backup") args.backup = false;
  }
  return args;
}

function printHelp() {
  process.stdout.write(
    `theokit-migrate-config — convert .theokit/ JSON configs to markdown (ADR D74-D78)

Usage:
  theokit-migrate-config [options]

Options:
  --cwd <path>     Workspace directory (default: cwd)
  --apply          Write the migrated .md files (default: dry-run, prints diff)
  --no-backup      Skip renaming originals to .json.<ts>.bak
  --help, -h       Show this help

Migrates:
  .theokit/hooks.json       → .theokit/hooks/<slug>.md
  .theokit/context.json     → .theokit/context/<slug>.md
  .theokit/plugins/<name>/plugin.json → .theokit/plugins/<name>/PLUGIN.md

Pre-flight aborts if MD destination already exists (avoids overwriting
manual edits). Atomic write per file (crash mid-write is safe).
`,
  );
}

/** Atomic write: tmpfile + rename. Mirrors atomicWriteText in the SDK. */
async function atomicWriteText(filePath, content) {
  await mkdir(join(filePath, ".."), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Math.random().toString(36).slice(2, 10)}.tmp`;
  await writeFile(tmp, content, "utf8");
  await rename(tmp, filePath);
}

function timestampSuffix() {
  return String(Math.floor(Date.now() / 1000));
}

function slugify(name) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "unnamed"
  );
}

function renderFrontmatter(fields, body) {
  const lines = ["---"];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      lines.push(`${k}: [${v.join(", ")}]`);
    } else {
      lines.push(`${k}: ${v}`);
    }
  }
  lines.push("---");
  if (body && body.length > 0) {
    lines.push("");
    lines.push(body);
  }
  lines.push("");
  return lines.join("\n");
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: nested JSON-shape parse + grouping by event — splitting reduces clarity
async function migrateHooks(cwd, args, plan) {
  const jsonPath = join(cwd, ".theokit", "hooks.json");
  if (!existsSync(jsonPath)) return;
  let parsed;
  try {
    parsed = JSON.parse(await readFile(jsonPath, "utf8"));
  } catch (cause) {
    plan.errors.push(`hooks.json: invalid JSON (${cause.message})`);
    return;
  }
  const hookGroups = parsed?.hooks ?? {};
  for (const [event, list] of Object.entries(hookGroups)) {
    if (!Array.isArray(list)) continue;
    for (const [idx, entry] of list.entries()) {
      const slug = `${event}-${idx + 1}`;
      const dest = join(cwd, ".theokit", "hooks", `${slug}.md`);
      const fields = {
        event,
        matcher: entry.matcher ?? ".",
        command: entry.command ?? "",
      };
      if (entry.timeoutMs !== undefined) fields.timeoutMs = entry.timeoutMs;
      const body = `TODO: explain why this hook exists.`;
      const content = renderFrontmatter(fields, body);
      plan.writes.push({ dest, content, kind: "hook" });
    }
  }
  if (args.backup && plan.writes.some((w) => w.kind === "hook")) {
    plan.backups.push({ from: jsonPath, to: `${jsonPath}.${timestampSuffix()}.bak` });
  }
}

async function migrateContext(cwd, args, plan) {
  const jsonPath = join(cwd, ".theokit", "context.json");
  if (!existsSync(jsonPath)) return;
  let parsed;
  try {
    parsed = JSON.parse(await readFile(jsonPath, "utf8"));
  } catch (cause) {
    plan.errors.push(`context.json: invalid JSON (${cause.message})`);
    return;
  }
  const sources = parsed?.sources ?? [];
  for (const src of sources) {
    if (typeof src?.name !== "string" || typeof src?.path !== "string") continue;
    const slug = slugify(src.name);
    const dest = join(cwd, ".theokit", "context", `${slug}.md`);
    const fields = { name: src.name, path: src.path };
    const body = `TODO: explain why "${src.path}" is part of the agent context.`;
    plan.writes.push({ dest, content: renderFrontmatter(fields, body), kind: "context" });
  }
  if (args.backup && plan.writes.some((w) => w.kind === "context")) {
    plan.backups.push({ from: jsonPath, to: `${jsonPath}.${timestampSuffix()}.bak` });
  }
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: per-plugin shape mapping needs the branch table inline
async function migratePlugins(cwd, args, plan) {
  const pluginsRoot = join(cwd, ".theokit", "plugins");
  if (!existsSync(pluginsRoot)) return;
  let entries;
  try {
    entries = await readdir(pluginsRoot, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const jsonPath = join(pluginsRoot, entry.name, "plugin.json");
    if (!existsSync(jsonPath)) continue;
    let parsed;
    try {
      parsed = JSON.parse(await readFile(jsonPath, "utf8"));
    } catch (cause) {
      plan.errors.push(`plugins/${entry.name}/plugin.json: invalid JSON (${cause.message})`);
      continue;
    }
    const dest = join(pluginsRoot, entry.name, "PLUGIN.md");
    const fields = {};
    if (typeof parsed.name === "string") fields.name = parsed.name;
    if (typeof parsed.version === "string") fields.version = parsed.version;
    if (Array.isArray(parsed.capabilities))
      fields.capabilities = parsed.capabilities.filter((c) => typeof c === "string");
    if (typeof parsed.entry === "string") fields.entry = parsed.entry;
    const body = `TODO: explain what plugin "${entry.name}" does.`;
    plan.writes.push({ dest, content: renderFrontmatter(fields, body), kind: "plugin" });
    if (args.backup) {
      plan.backups.push({ from: jsonPath, to: `${jsonPath}.${timestampSuffix()}.bak` });
    }
  }
}

async function preFlight(plan) {
  const conflicts = [];
  for (const w of plan.writes) {
    if (existsSync(w.dest)) conflicts.push(w.dest);
  }
  return conflicts;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: CLI entry orchestrates plan → preflight → write → backup; splitting hides the linear flow
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return 0;
  }

  const plan = { writes: [], backups: [], errors: [] };
  await migrateHooks(args.cwd, args, plan);
  await migrateContext(args.cwd, args, plan);
  await migratePlugins(args.cwd, args, plan);

  if (plan.errors.length > 0) {
    process.stderr.write(`Errors during migration plan:\n`);
    for (const e of plan.errors) process.stderr.write(`  - ${e}\n`);
    return 1;
  }

  if (plan.writes.length === 0) {
    process.stdout.write(
      `Nothing to migrate. No legacy JSON configs found under ${args.cwd}/.theokit/\n`,
    );
    return 0;
  }

  const conflicts = await preFlight(plan);
  if (conflicts.length > 0) {
    process.stderr.write(
      `Pre-flight aborted: destination MD files already exist:\n` +
        conflicts.map((c) => `  - ${c}`).join("\n") +
        `\n\nRemove or merge these files manually, then re-run.\n`,
    );
    return 2;
  }

  if (!args.apply) {
    process.stdout.write(`Migration plan (dry-run; pass --apply to write):\n\n`);
    for (const w of plan.writes) {
      process.stdout.write(`  + ${w.dest}  [${w.kind}]\n`);
    }
    if (args.backup) {
      process.stdout.write(`\nBackups would be created:\n`);
      for (const b of plan.backups) {
        process.stdout.write(`  - ${b.from} → ${b.to}\n`);
      }
    }
    return 0;
  }

  // Apply
  for (const w of plan.writes) {
    await atomicWriteText(w.dest, w.content);
    process.stdout.write(`wrote ${w.dest}\n`);
  }
  if (args.backup) {
    for (const b of plan.backups) {
      await rename(b.from, b.to);
      process.stdout.write(`backed up ${b.from} → ${b.to}\n`);
    }
  }
  process.stdout.write(`\nMigration complete. ${plan.writes.length} file(s) written.\n`);
  return 0;
}

main().then(
  (code) => process.exit(code ?? 0),
  (err) => {
    process.stderr.write(`Fatal: ${err?.stack ?? err}\n`);
    process.exit(1);
  },
);
