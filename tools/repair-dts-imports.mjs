#!/usr/bin/env node
// Post-build repair for the DTS rollup's export-without-import defect — #345.
//
// tsup/rollup-plugin-dts emits a symbol as a RE-EXPORT from a chunk and omits it from the `import`
// for that same chunk, while a local declaration in the same file uses the bare name. An
// `export … from` clause does not bind a name locally, so the reference dangles:
//
//   line 5:    import { R as RunResult, … } from './run-DsX-Lx_l.js';        <- no TokenUsage
//   line 6:    export { …, aw as TokenUsage, … } from './run-DsX-Lx_l.js';
//   line 985:      readonly usage: TokenUsage;                               <- unbound
//
// Measured 2026-08-20: 51 diagnostics across 7 names in 10 of 12 published packages. Our source is
// correct (`tsc -p packages/sdk` is clean) and tsup 8.5.1 is `latest`, so there is nothing to
// upgrade to and nothing to fix in the source.
//
// WHY POST-PROCESSING, given `tools/check-dts-exports.mjs` records a decision against it. That note
// declined it for ONE cosmetic disagreement, where the published shape was merely unhelpful. This is
// ten of twelve packages shipping a declaration that does not compile, which breaks type-aware lint
// in any consumer project. Same technique, different cost, different answer — stated here rather
// than left for someone to notice the two notes disagree.
//
// WHAT KEEPS IT HONEST. The repair never invents a name:
//
//   1. it only acts on a name the COMPILER reported as unresolved,
//   2. only when that exact name is already re-exported from a chunk in the same file, and
//   3. it copies that re-export's own alias, so the binding it adds is the one the rollup already
//      decided on.
//
// Then it re-runs the compiler. If the diagnostics did not go to zero, it says so and fails rather
// than reporting a repair it did not achieve. When the upstream defect is fixed, step 1 finds
// nothing and this becomes a no-op — it cannot mask a regression it is not triggered by.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

/** `path/to/file.d.ts(985,21): error TS2552: Cannot find name 'TokenUsage'.` */
const DIAGNOSTIC = /^(.+?\.d\.[cm]?ts)\((\d+),\d+\): error TS\d+: Cannot find name '([^']+)'/;

function typecheck(entryPath) {
  try {
    execFileSync(
      "npx",
      [
        "tsc",
        "--noEmit",
        "--strict",
        "--target",
        "es2022",
        "--module",
        "esnext",
        "--moduleResolution",
        "bundler",
        entryPath,
      ],
      { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return [];
  } catch (error) {
    return `${error.stdout ?? ""}${error.stderr ?? ""}`.split("\n").map((line) => line.trim());
  }
}

/** Unresolved names, grouped by the file that reported them. */
function unresolvedByFile(diagnostics) {
  const byFile = new Map();
  for (const line of diagnostics) {
    const match = DIAGNOSTIC.exec(line);
    if (match === null) continue;
    const [, file, , name] = match;
    if (!byFile.has(file)) byFile.set(file, new Set());
    byFile.get(file).add(name);
  }
  return byFile;
}

/**
 * Adds `name` to the `import` for the chunk that already re-exports it, in `source`.
 * Returns the new source, or `undefined` when there is no re-export to copy — in which case this is
 * NOT the defect being repaired and the diagnostic is left to stand.
 */
/**
 * The second shape of the same defect (#345), seen on `sdk-budget`: the unresolved name comes from
 * an EXTERNAL package rather than a local chunk, so there is no re-export in the file to copy an
 * alias from. `sdk-budget/src` does `import { type BudgetWindow, … } from "@theokit/sdk"`, and the
 * emitted declaration kept only the VALUE import (`BudgetTracker`) — the type-only names were
 * dropped while the declarations that use them were inlined.
 *
 * Same discipline as the local case, one extra proof obligation: the name is only added to a
 * module's import when that module's own published declaration actually EXPORTS it. Without that
 * check the repair would be guessing which dependency a name came from, which is exactly the kind
 * of invention this file exists not to do.
 */
function bindExternalName(source, name, pkgDir) {
  const importClause = /import\s*\{([^}]*?)\}\s*from\s*(['"])([^.'"][^'"]*)\2/g;
  for (const match of source.matchAll(importClause)) {
    const [, specifiers, quote, specifier] = match;
    if (new RegExp(String.raw`(?:^|,)\s*(?:\w+\s+as\s+)?${name}\s*(?:,|$)`).test(specifiers)) {
      return undefined; // already bound — not this defect
    }
    if (!moduleDeclares(specifier, name, pkgDir)) continue;
    return source.replace(
      match[0],
      `import { ${name},${specifiers}} from ${quote}${specifier}${quote}`,
    );
  }
  return undefined;
}

/** Does `specifier`'s published declaration name `name` as an export, resolved from `pkgDir`? */
function moduleDeclares(specifier, name, pkgDir) {
  const manifest = join(pkgDir, "node_modules", specifier, "package.json");
  if (!existsSync(manifest)) return false;
  const meta = JSON.parse(readFileSync(manifest, "utf8"));
  const root = meta.exports?.["."];
  const types = root?.import?.types ?? root?.types ?? meta.types ?? meta.typings;
  if (typeof types !== "string") return false;
  const declPath = join(pkgDir, "node_modules", specifier, types);
  if (!existsSync(declPath)) return false;
  const decl = readFileSync(declPath, "utf8");
  return new RegExp(
    String.raw`(?:^|[,{\s])(?:\w+\s+as\s+)?${name}(?=[,}\s])|\bdeclare\s+(?:type|interface|const|class|function)\s+${name}\b`,
  ).test(decl);
}

function bindReExportedName(source, name) {
  const exportClause = /export\s*\{([^}]*?)\}\s*from\s*(['"])(\.[^'"]+)\2/g;
  for (const match of source.matchAll(exportClause)) {
    const [, specifiers, , chunk] = match;
    const bound = new RegExp(String.raw`(?:^|,)\s*(?:(\w+)\s+as\s+)?${name}\s*(?:,|$)`).exec(
      specifiers,
    );
    if (bound === null) continue;
    const specifier = bound[1] === undefined ? name : `${bound[1]} as ${name}`;

    const importClause = new RegExp(
      String.raw`import\s*\{([^}]*?)\}\s*from\s*(['"])${chunk.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\2`,
    );
    const existing = importClause.exec(source);
    if (existing !== null) {
      // Already bound under some alias? Then this is not the defect; leave it alone.
      if (new RegExp(String.raw`(?:^|,)\s*(?:\w+\s+as\s+)?${name}\s*(?:,|$)`).test(existing[1])) {
        return undefined;
      }
      return source.replace(
        existing[0],
        `import { ${specifier},${existing[1]}} from ${existing[2]}${chunk}${existing[2]}`,
      );
    }
    return `import { ${specifier} } from '${chunk}';\n${source}`;
  }
  return undefined;
}

// Resolved against the CALLER's cwd, not the repo root. Package build scripts invoke this as
// `node ../../tools/repair-dts-imports.mjs .` from inside the package, and resolving "." against
// ROOT silently pointed every one of them at the monorepo manifest — which has no `types` entry, so
// the script exited 0 having done nothing. Measured: a full rebuild with this wired in left all 51
// diagnostics in place and printed not one line. A tool that finds nothing to do must be
// distinguishable from one that was never asked (CONTRIBUTING, "A silent gate reports absence it
// never checked") — hence the announcements below as well.
const target = process.argv[2] ?? ".";
const pkgDir = resolve(process.cwd(), target);
const manifestPath = join(pkgDir, "package.json");
if (!existsSync(manifestPath)) {
  console.error(`[dts-repair] no package.json at ${pkgDir}`);
  process.exit(2);
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const rootExport = manifest.exports?.["."];
const entry = rootExport?.import?.types ?? rootExport?.types ?? manifest.types ?? manifest.typings;
if (typeof entry !== "string") {
  console.log(
    `[dts-repair] ${manifest.name ?? target}: no published types entry — nothing to check.`,
  );
  process.exit(0);
}

const entryPath = join(pkgDir, entry);
if (!existsSync(entryPath)) {
  console.error(`[dts-repair] ${manifest.name}: declared types entry missing — ${entry}`);
  process.exit(1);
}

const before = typecheck(entryPath);
const unresolved = unresolvedByFile(before);
if (unresolved.size === 0) {
  console.log(`[dts-repair] ${manifest.name}: declaration resolves cleanly — nothing to bind.`);
  process.exit(0);
}

let repaired = 0;
for (const [file, names] of unresolved) {
  const filePath = resolve(ROOT, file);
  if (!existsSync(filePath)) continue;
  let source = readFileSync(filePath, "utf8");
  let touched = false;
  for (const name of names) {
    const next = bindReExportedName(source, name) ?? bindExternalName(source, name, pkgDir);
    if (next === undefined) continue;
    source = next;
    touched = true;
    repaired += 1;
  }
  if (touched) writeFileSync(filePath, source);
}

if (repaired === 0) {
  console.log(
    `[dts-repair] ${manifest.name}: ${unresolved.size} file(s) had unresolved names, but none was a ` +
      "re-export this can bind — left for the compiler to report.",
  );
  process.exit(0);
}

const after = typecheck(entryPath).filter((line) => /error TS\d+/.test(line));
if (after.length > 0) {
  console.error(
    `[dts-repair] ${manifest.name}: bound ${repaired} name(s), but ${after.length} diagnostic(s) remain:`,
  );
  for (const line of after.slice(0, 8)) console.error(`      ${line}`);
  console.error(
    "  Reporting the shortfall rather than the repair — see tools/repair-dts-imports.mjs.",
  );
  process.exit(1);
}

console.log(
  `[dts-repair] ${manifest.name}: bound ${repaired} re-exported name(s) the rollup left unimported (#345).`,
);
