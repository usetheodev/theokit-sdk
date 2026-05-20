#!/usr/bin/env node

// CLI wrapper for memory migration SQLite → Lance (ADR D44).
//
// Usage: theokit-migrate-memory [--cwd <path>] [--dry-run] [--keep-sqlite]
//                                [--batch-size <n>] [--help]

import { rmSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";

// Resolve the SDK build dist so this script works both from npm-installed
// `pnpm exec theokit-migrate-memory` and from the workspace.
import { migrateSqliteToLance } from "../dist/index.js";

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: arg parser must enumerate every flag inline; tiny CLI keeps the switch local.
function parseArgs(argv) {
  const args = {
    cwd: process.cwd(),
    dryRun: false,
    keepSqlite: false,
    batchSize: 100,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--cwd") args.cwd = argv[++i] ?? args.cwd;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--keep-sqlite") args.keepSqlite = true;
    else if (a === "--batch-size") args.batchSize = Number(argv[++i] ?? 100);
  }
  return args;
}

function printHelp() {
  process.stdout.write(
    `theokit-migrate-memory — migrate Memory.index from SQLite to LanceDB (ADR D44)

Usage:
  theokit-migrate-memory [options]

Options:
  --cwd <path>         Workspace directory (default: cwd)
  --dry-run            Read SQLite, validate counts, but DO NOT write Lance
  --keep-sqlite        Skip the "delete SQLite db?" prompt
  --batch-size <n>     Migration batch size (default: 100)
  --help, -h           Show this help

Algorithm:
  1. Read all facts from .theokit/memory/index.sqlite
  2. Write to .theokit/memory/lance-new/ (Lance staging dir)
  3. Validate: count match + sample-of-10 NFC unicode-normalized text match
  4. On success: rename lance-new/ → lance/  (atomic commit)
  5. Prompt to delete SQLite db (skipped with --keep-sqlite)
  6. On validation failure: leave SQLite intact, remove lance-new/
`,
  );
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: main orchestrates the CLI lifecycle (parse, validate, migrate, prompt, exit-code) — keeping it linear matches the user-facing flow.
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }
  process.stderr.write(`theokit-migrate-memory: cwd=${args.cwd} dry-run=${args.dryRun}\n`);
  let result;
  try {
    result = await migrateSqliteToLance({
      cwd: args.cwd,
      dryRun: args.dryRun,
      batchSize: args.batchSize,
      logger: (m) => process.stdout.write(`${m}\n`),
    });
  } catch (cause) {
    process.stderr.write(`FAILED: ${cause instanceof Error ? cause.message : String(cause)}\n`);
    process.exit(2);
  }

  if (result.countSqlite === 0) {
    process.stdout.write("Nothing to migrate (empty workspace).\n");
    process.exit(0);
  }

  process.stdout.write(`\nSummary:\n`);
  process.stdout.write(`  SQLite facts:   ${result.countSqlite}\n`);
  process.stdout.write(`  Lance facts:    ${result.countLance}\n`);
  process.stdout.write(
    `  Sample compare: ${result.sampleComparisons.filter((c) => c.match).length}/${result.sampleComparisons.length} match\n`,
  );
  process.stdout.write(`  Committed:      ${result.committed}\n`);

  if (!result.validated) {
    process.stderr.write("Validation FAILED. SQLite preserved.\n");
    process.exit(3);
  }

  if (result.committed && !args.keepSqlite) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(
      `Delete SQLite db at ${join(args.cwd, ".theokit/memory/index.sqlite")}? [y/N] `,
    );
    rl.close();
    if (answer.trim().toLowerCase() === "y") {
      rmSync(join(args.cwd, ".theokit/memory/index.sqlite"), { force: true });
      process.stdout.write("SQLite db deleted.\n");
    } else {
      process.stdout.write("SQLite db preserved.\n");
    }
  }
  process.exit(0);
}

await main();
