#!/usr/bin/env node
// Public-API documentation coverage, asked of the TypeScript compiler over the PUBLISHED
// declarations — the same question a consumer's editor asks when it renders a tooltip.
//
// WHY THE COMPILER AND NOT A REGEX. An early regex pass put the source at 77% and the emitted entry
// at 38%. Two instruments disagreeing by 39 points is not a measurement. `getExportsOfModule` gives
// the real export list (aliases followed to the declaration they point at) and
// `getDocumentationComment` says which of them a reader actually gets text for.
//
// WHY THE EMIT AND NOT THE SOURCE. A docblock in the source is not documentation until it survives
// the build. Two mechanisms delete it silently here, and both were measured on 2026-08-20:
//
//   - `stripInternal` (tsconfig.base.json) removes a declaration outright when the literal
//     `@internal` appears in ANY leading comment range of it — a file header included. See
//     `check-dts-export-parity.mjs`.
//   - A docblock whose FIRST line begins with `@` is parsed as a tag, and the whole block becomes
//     that tag's value. `/** @theokit/sdk — …` yields `getDocumentationComment() === []` and an
//     invented tag named `theokit`. The comment is plainly visible in the `.d.ts` and reaches no
//     reader. Seventeen files in this workspace open that way; they are headers followed by an
//     `import`, which is harmless only until someone moves a declaration up. That shape is reported
//     with its own diagnostic below, because "you wrote documentation and got none" needs a
//     different sentence than "you wrote none".
//
// THE FLOOR IS A RATCHET, NOT A TARGET. Raise it when the number rises; never lower it to make a
// run pass. A symbol that cannot be documented is a symbol that should not be exported.
//
// Usage: node tools/check-doc-coverage.mjs [--list <package>]

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative } from "node:path";
import { declaredEntries, ROOT } from "./lib/published-entries.mjs";

const require = createRequire(import.meta.url);
const ts = require(join(ROOT, "node_modules/typescript"));

const listIndex = process.argv.indexOf("--list");
const LIST = listIndex === -1 ? undefined : process.argv[listIndex + 1];

/**
 * JSDoc tags TypeScript legitimately recognises. A first-line tag OUTSIDE this set is almost always
 * a package specifier the author meant as prose — `@theokit/sdk`, `@param`-shaped by accident.
 */
const KNOWN_TAGS = new Set([
  "param",
  "returns",
  "return",
  "throws",
  "example",
  "see",
  "deprecated",
  "public",
  "private",
  "protected",
  "internal",
  "remarks",
  "typeParam",
  "template",
  "defaultValue",
  "default",
  "since",
  "author",
  "link",
  "module",
  "packageDocumentation",
  "alpha",
  "beta",
  "experimental",
  "override",
  "readonly",
  "sealed",
  "virtual",
  "inheritDoc",
  "type",
  "typedef",
  "callback",
]);

/** Minimum share of public exports carrying documentation. A ratchet — see the header. */
const FLOOR_PERCENT = 100;

const all = declaredEntries({ condition: "import" }).map((entry) => ({
  pkg: entry.pkg,
  subpath: entry.subpath,
  file: entry.typesAbs,
}));
const missing = all.filter((e) => !existsSync(e.file));
if (missing.length > 0) {
  console.error(`[doc-coverage] ✗ ${missing.length} declared entr(ies) are not built:`);
  for (const e of missing.slice(0, 12)) console.error(`      ${e.pkg}${e.subpath.slice(1)}`);
  console.error("  Run 'pnpm build' first. A coverage number over a partial tree is not a number.");
  process.exit(1);
}

const program = ts.createProgram(
  all.map((e) => e.file),
  {
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    types: [],
  },
);
const checker = program.getTypeChecker();

const perPackage = new Map();
const undocumented = [];

/**
 * Entries the compiler could not read as a module. NOT skipped: a `.d.ts` that is not a module is
 * exactly what a broken emit looks like, and it is the failure this whole gate exists to catch.
 *
 * Measured 2026-08-20: with one package's declaration replaced by a non-module file, the previous
 * `continue` made that package vanish from the per-package table and the run reported
 * `1118/1118 … 100.0%` and PASS. A denominator that shrinks with the damage cannot measure it.
 */
const unreadable = [];

for (const entry of all) {
  const source = program.getSourceFile(entry.file);
  const moduleSymbol = source === undefined ? undefined : checker.getSymbolAtLocation(source);
  if (moduleSymbol === undefined) {
    unreadable.push(entry);
    continue;
  }

  for (const symbol of checker.getExportsOfModule(moduleSymbol)) {
    const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
    const parts = target.getDocumentationComment(checker);
    const documented = parts.some((part) => part.text.trim().length > 0);

    const stats = perPackage.get(entry.pkg) ?? { total: 0, documented: 0 };
    stats.total += 1;
    if (documented) stats.documented += 1;
    perPackage.set(entry.pkg, stats);

    if (documented) continue;

    // A block that DID exist and yielded nothing: the leading-`@` shape. Distinguished so the
    // author is told the block was swallowed rather than told to write one they already wrote.
    const tags = target.getJsDocTags(checker).map((t) => t.name);
    const swallowed = tags.length > 0 && !KNOWN_TAGS.has(tags[0]);
    const declaration = target.declarations?.[0];
    undocumented.push({
      pkg: entry.pkg,
      specifier: entry.subpath === "." ? entry.pkg : `${entry.pkg}${entry.subpath.slice(1)}`,
      name: symbol.getName(),
      where: declaration ? relative(ROOT, declaration.getSourceFile().fileName) : "?",
      swallowed,
      tag: swallowed ? tags[0] : undefined,
    });
  }
}

if (LIST !== undefined) {
  const rows = undocumented.filter((u) => u.pkg === LIST || u.pkg.endsWith(`/${LIST}`));
  console.log(`${rows.length} undocumented export(s) in ${LIST}:\n`);
  const byFile = new Map();
  for (const row of rows) byFile.set(row.where, [...(byFile.get(row.where) ?? []), row]);
  for (const [file, list] of [...byFile].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${String(list.length).padStart(3)}  ${file}`);
    console.log(
      `       ${list
        .map((r) => r.name)
        .sort()
        .join(", ")}`,
    );
  }
  process.exit(0);
}

let total = 0;
let documented = 0;
const rows = [...perPackage].map(([pkg, s]) => {
  total += s.total;
  documented += s.documented;
  return [pkg, s.total, s.documented, Math.round((100 * s.documented) / s.total)];
});
rows.sort((a, b) => a[3] - b[3] || a[0].localeCompare(b[0]));

console.log(`${"package".padEnd(30)}exports  documented    %`);
for (const [pkg, t, d, percent] of rows) {
  const mark = d === t ? " " : "!";
  console.log(
    `${mark}${pkg.padEnd(29)}${String(t).padStart(7)}${String(d).padStart(12)}${String(percent).padStart(5)}%`,
  );
}

if (unreadable.length > 0) {
  console.error("");
  console.error(
    `[doc-coverage] ✗ ${unreadable.length} published entr(ies) could not be read as a module:`,
  );
  for (const entry of unreadable) {
    console.error(`      ${entry.pkg}${entry.subpath.slice(1)} → ${relative(ROOT, entry.file)}`);
  }
  console.error("");
  console.error(
    "[doc-coverage] FAIL — the coverage number below excludes them, so it is not a measurement",
  );
  console.error("  of the published surface. Rebuild, or fix the emit.");
  process.exit(1);
}

const percent = total === 0 ? 100 : (100 * documented) / total;
console.log("");
console.log(
  `[doc-coverage] ${documented}/${total} public export(s) documented across ${all.length} ` +
    `declared entr(ies) — ${percent.toFixed(1)}%.`,
);

const swallowedRows = undocumented.filter((u) => u.swallowed);
if (swallowedRows.length > 0) {
  console.error("");
  console.error(
    `[doc-coverage] ✗ ${swallowedRows.length} symbol(s) HAVE a docblock that yields no ` +
      "documentation — its first line starts with `@`, so TypeScript read the whole block as the",
  );
  console.error("  value of a tag it invented. Move the text below a first line that is prose:");
  for (const row of swallowedRows.slice(0, 12)) {
    console.error(`      ${row.where}  ${row.name}  (parsed as tag \`@${row.tag}\`)`);
  }
}

if (percent + 1e-9 < FLOOR_PERCENT) {
  console.error("");
  console.error(
    `[doc-coverage] FAIL — ${percent.toFixed(1)}% is below the ${FLOOR_PERCENT}% floor; ` +
      `${undocumented.length} export(s) carry no documentation.`,
  );
  console.error("  List them with: node tools/check-doc-coverage.mjs --list <package-name>");
  console.error(
    "  Fix by documenting the symbol, or by not exporting it. Never by lowering the floor.",
  );
  process.exit(1);
}

if (swallowedRows.length > 0) process.exit(1);
console.log(`[doc-coverage] PASS — at or above the ${FLOOR_PERCENT}% floor.`);
