#!/usr/bin/env node
// Cross-package duplication ratchet — #295.
//
// The previous gate ran `jscpd packages/sdk/src`: one package out of fifteen. It
// reported 0 clones while 3,647 duplicated lines sat across the workspace, because
// every one of them is a copy that spans TWO packages and the scan only ever saw
// one side.
//
// What it was blind to, measured the day this was written:
//
//     283  sdk-memory/internal/index/index-manager.ts  ↔  sdk/internal/memory/index-manager.ts
//     262  sdk-memory/internal/index/lance-index.ts    ↔  sdk/internal/memory/lance-index.ts
//     242  sdk-memory/internal/active-memory/…         ↔  sdk/internal/memory/active-memory.ts
//     233  sdk-memory/internal/index/migrate-…         ↔  sdk/internal/memory/migrate-…
//     135  sdk-budget/internal/enforcement.ts          ↔  sdk/internal/budget/enforcement.ts
//
// This is not accidental copy-paste. The SDK 2.0 split moved whole subsystems into
// extracted satellites while sdk-core kept its copies as the v1.x runtime, behind
// `THEOKIT_PORT_MEMORY_PATH`, which still defaults OFF. Collapsing them is that
// migration, not a cleanup — see the header of
// `packages/sdk-memory/src/internal/active-memory/active-memory.ts`.
//
// So this gate does not demand zero. It PINS the debt: the current figure is the
// ceiling, and anything above it fails. A new copy-paste cannot land, and the
// number only moves down — deliberately, in a commit that says why.
//
// Lower BUDGET whenever a consolidation lands. Raising it needs a reason in the
// commit message; a budget that drifts upward is not a ratchet, it is a record of
// giving up.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Duplicated lines across `packages/*​/src`, as measured on 2026-08-17.
 *
 * 3647 across 93 clones. Pinned exactly: the point is that it cannot grow, and a
 * budget with slack in it is slack someone will spend.
 */
const BUDGET_LINES = Number(process.env.MAX_DUPLICATED_LINES ?? 3647);

const out = mkdtempSync(join(tmpdir(), "jscpd-gate-"));
try {
  const run = spawnSync(
    "npx",
    ["jscpd", "packages/*/src", "--reporters", "json", "--output", out, "--silent"],
    { cwd: ROOT, encoding: "utf8", shell: true, timeout: 300_000 },
  );

  let report;
  try {
    report = JSON.parse(readFileSync(join(out, "jscpd-report.json"), "utf8"));
  } catch {
    console.error("✗ Duplication gate could not read the jscpd report.");
    console.error((run.stderr || run.stdout || "").slice(0, 800));
    process.exit(2);
  }

  const { clones, duplicatedLines, percentage } = report.statistics.total;

  console.log(
    `jscpd across packages/*/src: ${clones} clone(s), ${duplicatedLines} duplicated line(s) (${percentage}%)`,
  );
  console.log(`gate budget: ≤ ${BUDGET_LINES} duplicated lines`);

  if (duplicatedLines > BUDGET_LINES) {
    console.error(
      `\n✗ Duplication gate FAILED: ${duplicatedLines} exceeds the budget of ${BUDGET_LINES} by ${
        duplicatedLines - BUDGET_LINES
      }.`,
    );
    // Name the worst pairs — a percentage tells nobody which file to open.
    const pairs = new Map();
    for (const d of report.duplicates ?? []) {
      const a = d.firstFile.name.split("packages/").pop();
      const b = d.secondFile.name.split("packages/").pop();
      const key = `${a}\n        ↔ ${b}`;
      pairs.set(key, (pairs.get(key) ?? 0) + d.lines);
    }
    console.error("\nLargest duplicated pairs:");
    for (const [pair, lines] of [...pairs].sort((x, y) => y[1] - x[1]).slice(0, 6)) {
      console.error(`  ${String(lines).padStart(4)}  ${pair}`);
    }
    console.error(
      "\nExtract the shared logic, or — if this is a staged migration like the SDK 2.0\n" +
        "split — land the consolidation and LOWER the budget in the same commit.\n",
    );
    process.exit(1);
  }

  if (duplicatedLines < BUDGET_LINES) {
    console.log(
      `\n✓ Duplication gate passed, and the figure dropped by ${
        BUDGET_LINES - duplicatedLines
      } line(s).\n  Lower MAX_DUPLICATED_LINES in tools/check-duplication.mjs to ${duplicatedLines} so it cannot come back.`,
    );
    process.exit(0);
  }

  console.log("✓ Duplication gate passed (at budget).");
  process.exit(0);
} finally {
  rmSync(out, { recursive: true, force: true });
}
