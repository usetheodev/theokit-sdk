#!/usr/bin/env node
// Export-parity gate: every symbol a package's SOURCE barrel exports must be present in the
// DECLARATION it publishes for that entry.
//
// WHY THIS IS NOT COVERED BY THE OTHER TWO. `check-dts-exports.mjs` asks whether a re-export in the
// emit resolves, and whether a declared value exists on the `.js`. `check-dts-typechecks.mjs` asks
// whether the emitted declaration compiles. Both start from the EMIT — so a symbol that never
// reached the emit at all is invisible to both, and the emit compiles precisely because nothing
// dangles.
//
// Measured 2026-08-20 on `@theokit/sdk-memory`: `MemoryChunk`, `MemorySearchHit`, `LanceIndex` and
// `writeSessionSummary` are exported from `src/index.ts` and absent from `dist/index.d.ts`. The
// typecheck gate reported that package ✓. A consumer writing
// `import { MemoryChunk } from "@theokit/sdk-memory"` gets TS2305 in THEIR project, against a name
// the source, the README and the barrel all say exists.
//
// The mechanism is `stripInternal` (set in `tsconfig.base.json`): TypeScript deletes a declaration
// when the literal `@internal` appears in ANY leading comment range of it — including a file header
// that no statement separates from the first declaration. The tag is frequently used here to mean
// "outside the semver contract" (`internal/persistence/sqlite-open.ts` says exactly that, in those
// words, on a subpath the manifest publishes and a back-compat test pins). The compiler reads it as
// "erase this", and the two intentions only diverge in the published artifact.
//
// There is no waiver list, deliberately. A symbol that should not be published should not be
// exported from a published barrel; the fix is always in the source, never here.
//
// Usage: node tools/check-dts-export-parity.mjs

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative } from "node:path";
import { declaredEntries, ROOT, sourceBarrelFor } from "./lib/published-entries.mjs";

const require = createRequire(import.meta.url);
const ts = require(join(ROOT, "node_modules/typescript"));

/** How many missing names to print per entry before eliding. */
const MAX_SHOWN = 14;

// BOTH conditions: the `.d.ts` and the `.d.cts` are emitted separately and have been measured to
// disagree, so parity over one of them is parity over half the published surface.
const entries = declaredEntries().map((entry) => ({
  specifier: entry.condition === "require" ? `${entry.specifier} (require)` : entry.specifier,
  emitted: entry.typesAbs,
  source: sourceBarrelFor(entry),
}));

// An unresolvable source barrel is reported, never skipped: a gate that quietly drops the entries it
// could not map reports absence it never checked.
const unmapped = entries.filter((e) => e.source === undefined);
const unbuilt = entries.filter((e) => e.source !== undefined && !existsSync(e.emitted));
const checkable = entries.filter((e) => e.source !== undefined && existsSync(e.emitted));

if (unbuilt.length > 0) {
  console.error(`[dts-parity] ✗ ${unbuilt.length} declared entr(ies) are not built:`);
  for (const e of unbuilt.slice(0, MAX_SHOWN)) {
    console.error(`      ${e.specifier} → ${relative(ROOT, e.emitted)}`);
  }
  console.error("  Run 'pnpm build' first — this gate does not pass on an unbuilt tree.");
  process.exit(1);
}

const program = ts.createProgram(
  [...checkable.map((e) => e.source), ...checkable.map((e) => e.emitted)],
  {
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  },
);
const checker = program.getTypeChecker();

/** The names a module exports, asked of the compiler rather than matched as text. */
function exportedNames(file) {
  const source = program.getSourceFile(file);
  if (source === undefined) return undefined;
  const moduleSymbol = checker.getSymbolAtLocation(source);
  if (moduleSymbol === undefined) return undefined;
  return new Set(checker.getExportsOfModule(moduleSymbol).map((s) => s.getName()));
}

const failures = [];
let checkedNames = 0;

for (const entry of checkable) {
  const fromSource = exportedNames(entry.source);
  const fromEmit = exportedNames(entry.emitted);
  if (fromSource === undefined || fromEmit === undefined) {
    failures.push({ entry, missing: [], unreadable: true });
    continue;
  }
  checkedNames += fromSource.size;
  const missing = [...fromSource].filter((name) => !fromEmit.has(name)).sort();
  if (missing.length > 0) failures.push({ entry, missing, unreadable: false });
}

for (const { entry, missing, unreadable } of failures) {
  if (unreadable) {
    console.error(`[dts-parity] ✗ ${entry.specifier} — could not read the module symbol`);
    continue;
  }
  console.error(
    `[dts-parity] ✗ ${entry.specifier} — ${missing.length} exported name(s) absent from the emit`,
  );
  console.error(`      source: ${relative(ROOT, entry.source)}`);
  console.error(`      emit:   ${relative(ROOT, entry.emitted)}`);
  console.error(`      ${missing.slice(0, MAX_SHOWN).join(", ")}`);
  if (missing.length > MAX_SHOWN) console.error(`      … ${missing.length - MAX_SHOWN} more`);
}

if (unmapped.length > 0) {
  console.error("");
  console.error(
    `[dts-parity] ${unmapped.length} declared entr(ies) have no source barrel this gate`,
  );
  console.error("  could locate, so they were NOT checked:");
  for (const e of unmapped) console.error(`      ${e.specifier}`);
}

if (failures.length > 0) {
  console.error("");
  console.error(
    `[dts-parity] FAIL — ${failures.length} of ${checkable.length} published entr(ies) omit a name ` +
      "their source barrel exports.",
  );
  console.error(
    "  The declaration still COMPILES: nothing dangles, because the symbol never reached the",
  );
  console.error(
    "  emit. The break lands in the consumer's project, on a name our own README promises.",
  );
  console.error(
    "  Usual cause: `@internal` in a leading comment of the declaration, or of the file",
  );
  console.error("  header above it. Remove the tag, or stop exporting the symbol from the barrel.");
  process.exit(1);
}

// UNMAPPED ENTRIES ARE A FAILURE, AND THE FAILURE IS ANNOUNCED BEFORE THE VERDICT. The previous
// order printed `PASS` and then exited 1, so a red run's last line said green — the same defect this
// gate exists to catch, in the gate itself. Zero entries are unmapped today; renaming one source
// barrel reproduces it.
if (unmapped.length > 0) {
  console.error("");
  console.error(
    `[dts-parity] FAIL — ${unmapped.length} declared entr(ies) have no source barrel to compare ` +
      "against, so nothing was checked for them.",
  );
  console.error(
    "  Either the entry moved, or the dist→src mapping in tools/lib needs the new shape.",
  );
  process.exit(1);
}

console.log(
  `[dts-parity] PASS — ${checkedNames} exported name(s) across ${checkable.length} published ` +
    `entr(ies) are present in the declaration each one publishes.`,
);
