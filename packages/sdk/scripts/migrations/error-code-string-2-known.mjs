#!/usr/bin/env node

/**
 * T1.1 migration codemod — `AgentRunErrorCode` to `KnownAgentRunErrorCode`.
 *
 * Pre-T1.1 the SDK exported `AgentRunErrorCode = ErrorCode | ... | (string & {})`
 * which silently accepted any string. T1.1 closed the union; legacy callers
 * may need surgery in three shapes:
 *
 *   1. `import { AgentRunErrorCode } from '@theokit/sdk'` — KEEP. The alias
 *      is preserved as a re-export of `KnownAgentRunErrorCode`. No edit.
 *   2. Callers passing a raw arbitrary string for `code: ...` — UPDATE.
 *      Wrap the value with `coerceToKnownAgentRunErrorCode(raw)`.
 *   3. Type annotation `code: string` in caller code — UPDATE to
 *      `code: KnownAgentRunErrorCode`.
 *
 * Run: `node packages/sdk/scripts/migrations/error-code-string-2-known.mjs <path>`
 *      (default: cwd). Use `--write` to apply; default is dry-run.
 *
 * Conservative regex-based codemod. For complex cases, prefer manual review
 * + `tsc --noEmit` for confirmation.
 */

import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const write = args.includes("--write");
const root = args.find((a) => !a.startsWith("--")) ?? ".";

// `execFileSync` with an argument array, not `execSync` with an interpolated string: `root`
// comes from `process.argv`, and a path containing a shell metacharacter would have been
// interpreted rather than passed through (CodeQL js/indirect-command-line-injection #25 and
// js/shell-command-injection-from-environment #13). No shell is spawned at all now, so there is
// nothing to escape — parsimony ladder rung 2, the standard library already draws this line.
const files = execFileSync("git", ["-C", resolve(root), "ls-files", "*.ts", "*.tsx"], {
  encoding: "utf8",
})
  .split("\n")
  .filter((p) => p.length > 0)
  .map((p) => resolve(root, p));

let changedCount = 0;

for (const file of files) {
  const original = await readFile(file, "utf8");
  let updated = original;

  // (1) `code: result.error.code ?? "unknown"` — wrap with coerceToKnownAgentRunErrorCode
  updated = updated.replace(
    /\bcode:\s*([A-Za-z_$][\w.$]*\.code)\s*\?\?\s*"unknown"/g,
    "code: coerceToKnownAgentRunErrorCode($1)",
  );

  // (2) Type annotations `code: string` inside an `AgentRunError` ctor opts literal
  // are a narrow pattern; flag-only (rare in practice).
  // Skip — too risky to mass-rewrite without context.

  if (updated !== original) {
    changedCount += 1;
    if (write) {
      await writeFile(file, updated, "utf8");
      process.stdout.write(`updated: ${file}\n`);
    } else {
      process.stdout.write(`would update (dry-run): ${file}\n`);
    }
  }
}

process.stdout.write(
  `\nT1.1 codemod ${write ? "applied" : "DRY-RUN"}; files touched: ${changedCount}\n`,
);
process.stdout.write(
  "Reminder: after running with --write, run `pnpm typecheck` and audit any TS2322 on `code` fields. Cast to `as KnownAgentRunErrorCode` if you must preserve a legacy value.\n",
);
