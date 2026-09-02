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
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

/**
 * Escapes a name for literal use inside `new RegExp`. The rollup dedupes colliding identifiers as
 * `Name$1`, and `$` is an end-of-input anchor: unescaped, the pattern for `Plugin$1` matches
 * nothing, so the tool declined to bind the very identifiers it exists for and reported success.
 * `Plugin$1`, `FetchLike$1`, `Skill$1` and `HandoffDescriptor$1` are all present in this repo's own
 * built declarations. The adjacent `chunk` was already escaped; the name was not.
 */
function escapeRegExp(literal) {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `path/to/file.d.ts(985,21): error TS2552: Cannot find name 'TokenUsage'.` */
const DIAGNOSTIC = /^(.+?\.d\.[cm]?ts)\((\d+),\d+\): error TS\d+: Cannot find name '([^']+)'/;

const ts = createRequire(import.meta.url)(join(ROOT, "node_modules/typescript"));

const LABEL = "dts-repair";

function typecheck(entryPaths) {
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
        ...entryPaths,
      ],
      { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return [];
  } catch (error) {
    // A FAILED INVOCATION IS NOT A CLEAN COMPILE. `tsc` exits 1 or 2 with diagnostics on stdout;
    // a spawn that never ran (npx absent, ENOENT, a killed process) arrives here with
    // `status === null` and `stdout === null`, and the old body turned that into `[]` — which every
    // caller reads as "no diagnostics". Measured 2026-08-20: with `npx` off PATH this printed
    // `PASS — 45 published declaration(s) compile without skipLibCheck` in under a second, having
    // compiled nothing, with output byte-identical to a genuine four-minute green run. That is the
    // exact shape this file's header forbids, one level down from where it was looking.
    if (typeof error.status !== "number") {
      console.error(`[${LABEL}] ✗ tsc could not be run: ${error.message}`);
      console.error(
        "  Refusing to report: a gate that cannot invoke its tool has checked nothing.",
      );
      process.exit(2);
    }
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
    if (
      new RegExp(String.raw`(?:^|,)\s*(?:\w+\s+as\s+)?${escapeRegExp(name)}\s*(?:,|$)`).test(
        specifiers,
      )
    ) {
      return undefined; // already bound — not this defect
    }
    if (!moduleDeclares(specifier, name, pkgDir)) continue;
    return source.replace(
      match[0],
      `import { ${escapeRegExp(name)},${specifiers}} from ${quote}${specifier}${quote}`,
    );
  }

  // The SIDE-EFFECT form: `import '@theokit/sdk';` with no bindings at all. The rollup emits the
  // specifier and drops every name it was meant to carry, so there is no clause to append to and
  // the loop above matches nothing. Measured on `@theokit/sdk-handoff`'s `./internal` entry, where
  // `SDKAgent` and `CustomTool` were unresolved through two builds — invisible until the typecheck
  // gate stopped reading only `exports["."]`.
  //
  // Rewriting it to a named import keeps the module reference and binds the name. Deliberately NOT
  // handled: inserting a fresh import when the file names the module nowhere. That case has no
  // measured instance, and the shortfall is already reported rather than silently passed.
  const bareImport = /import\s*(['"])([^.'"][^'"]*)\1\s*;/g;
  for (const match of source.matchAll(bareImport)) {
    const [, quote, specifier] = match;
    if (!moduleDeclares(specifier, name, pkgDir)) continue;
    return source.replace(
      match[0],
      `import { ${escapeRegExp(name)} } from ${quote}${specifier}${quote};`,
    );
  }
  return undefined;
}

/**
 * The THIRD shape, measured 2026-09-01 on `@theokit/sdk`: the unresolved name lives in a SIBLING
 * declaration in the same `dist/`, and the emitted file names no module at all.
 *
 * `internal/eval/single-flight.d.ts` declares `class EvalAlreadyRunningError extends
 * TheokitAgentError` and imports nothing, because `src/errors.ts` is not in that tsc pass's `include`
 * — it is produced by the rollup path instead — so the compiler elided the import while keeping the
 * declaration that needs it. Adding `errors.ts` to the include list would give one declaration two
 * producers, which `tsup.config.ts` documents at length as the hazard to avoid.
 *
 * The comment on {@link bindExternalName} declined this case for want of a measured instance. This
 * is that instance, and it carries the same proof obligation, satisfiable the same way: the import
 * is written ONLY when a sibling declaration in this dist actually exports the name. Nothing is
 * guessed — if no sibling exports it, the diagnostic stands.
 */
function bindSiblingName(source, name, filePath, distDir) {
  if (new RegExp(String.raw`\bimport\s*\{[^}]*\b${escapeRegExp(name)}\b`).test(source)) {
    return undefined; // already bound — not this defect
  }
  const candidates = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".d.ts")) candidates.push(full);
    }
  };
  walk(distDir);

  for (const candidate of candidates) {
    if (candidate === filePath) continue;
    if (!exportNamesOf(candidate).has(name)) continue;
    let specifier = relative(dirname(filePath), candidate)
      .replace(/\\/g, "/")
      .replace(/\.d\.ts$/, ".js");
    if (!specifier.startsWith(".")) specifier = `./${specifier}`;
    return `import { ${name} } from "${specifier}";\n${source}`;
  }
  return undefined;
}

/**
 * Does `specifier`'s published declaration EXPORT `name`, resolved from `pkgDir`?
 *
 * Asked of the compiler. The previous regex required only that the token sit between whitespace or
 * braces, which every word in a JSDoc paragraph satisfies — `moduleDeclares("@theokit/sdk", "Codex")`
 * returned true against four prose mentions and no declaration. This is the one guard on the
 * bare-import rewrite, so a false positive writes `import { Codex } from '@theokit/sdk';` into a
 * published declaration: a fabricated import, which is the single thing this tool must never do.
 */
function moduleDeclares(specifier, name, pkgDir) {
  const manifest = join(pkgDir, "node_modules", specifier, "package.json");
  if (!existsSync(manifest)) return false;
  const meta = JSON.parse(readFileSync(manifest, "utf8"));
  const root = meta.exports?.["."];
  const types = root?.import?.types ?? root?.types ?? meta.types ?? meta.typings;
  if (typeof types !== "string") return false;
  const declPath = join(pkgDir, "node_modules", specifier, types);
  if (!existsSync(declPath)) return false;

  const cached = exportNamesOf(declPath);
  return cached.has(name);
}

/** Export names of a declaration file, memoised — each call would otherwise build a program. */
const exportNameCache = new Map();
function exportNamesOf(declPath) {
  const hit = exportNameCache.get(declPath);
  if (hit !== undefined) return hit;

  const program = ts.createProgram([declPath], {
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    types: [],
  });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(declPath);
  const moduleSymbol = source === undefined ? undefined : checker.getSymbolAtLocation(source);
  const names = new Set(
    moduleSymbol === undefined
      ? []
      : checker.getExportsOfModule(moduleSymbol).map((symbol) => symbol.getName()),
  );
  exportNameCache.set(declPath, names);
  return names;
}

/**
 * The FOURTH shape, measured 2026-09-02 on `@theokit/sdk`: the name IS imported — under an ALIAS the
 * rollup minted for the chunk (`d as RunEventSink$1`) — and a declaration it hoisted into the same
 * file still refers to the BARE name. The compiler's own message says so: TS2552, "Cannot find name
 * 'RunEventSink'. Did you mean 'RunEventSink$1'?".
 *
 * It appeared the moment `emitRunEvent` moved out of `src/types/run-events.ts` into a runtime module
 * — `src/types/*` is the pure-type layer and a value there can only reach a consumer through the DTS
 * rollup, which is the #279 defect. With the function and the interface in one source file they
 * landed in one chunk and the reference needed no renaming; split across two, rollup renamed the
 * import and left the use site alone.
 *
 * Same proof obligation as the three above, and the cheapest one to satisfy: the alias is only
 * substituted when THIS file's own import clause binds `<chunk-local> as <name>$<n>`. Nothing is
 * inferred from the diagnostic text, so a TS2552 whose suggestion does not correspond to a real
 * alias in this file is left to stand.
 */
function bindAliasedName(source, name) {
  const alias = new RegExp(
    String.raw`import\s*\{[^}]*?\b\w+\s+as\s+(${escapeRegExp(name)}\$\d+)\b[^}]*?\}\s*from`,
  ).exec(source);
  if (alias === null) return undefined;

  // Rewrite the bare name only where it is USED as a type reference — never inside the import
  // clause that introduced the alias, and never as part of a longer identifier.
  const bare = new RegExp(String.raw`(?<![\w$.])${escapeRegExp(name)}(?![\w$])`, "g");
  let touched = false;
  const next = source.replace(bare, (match, offset) => {
    if (offset >= alias.index && offset < alias.index + alias[0].length) return match;
    touched = true;
    return alias[1];
  });
  return touched ? next : undefined;
}

function bindReExportedName(source, name) {
  const exportClause = /export\s*\{([^}]*?)\}\s*from\s*(['"])(\.[^'"]+)\2/g;
  for (const match of source.matchAll(exportClause)) {
    const [, specifiers, , chunk] = match;
    const bound = new RegExp(
      String.raw`(?:^|,)\s*(?:(\w+)\s+as\s+)?${escapeRegExp(name)}\s*(?:,|$)`,
    ).exec(specifiers);
    if (bound === null) continue;
    const specifier = bound[1] === undefined ? name : `${bound[1]} as ${escapeRegExp(name)}`;

    const importClause = new RegExp(
      String.raw`import\s*\{([^}]*?)\}\s*from\s*(['"])${chunk.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\2`,
    );
    const existing = importClause.exec(source);
    if (existing !== null) {
      // Already bound under some alias? Then this is not the defect; leave it alone.
      if (
        new RegExp(String.raw`(?:^|,)\s*(?:\w+\s+as\s+)?${escapeRegExp(name)}\s*(?:,|$)`).test(
          existing[1],
        )
      ) {
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
/**
 * Restores the `type` modifier the DTS rollup drops from a type-only export of a CLASS.
 *
 * `src/index.ts` exports `LiveAgentRegistry` inside an `export type { … }` block, with a comment
 * saying the runtime singleton is reached via `Agent.registry` instead. The rollup emits
 * `declare class LiveAgentRegistry` and re-exports it as a VALUE, so the published declaration
 * offers a constructor that `dist/index.js` does not export at all. A consumer writing
 * `new LiveAgentRegistry()` typechecks and fails at runtime — the exact class `check-dts-exports.mjs`
 * was built for (#279), sitting in that gate's own known-exceptions list because the note there said
 * fixing it "means post-processing the bundled .d.ts". This is that post-processing.
 *
 * The SOURCE is the authority, not a heuristic: a name is only converted when the package's own
 * barrel exports it under `export type {`. Nothing is inferred from the runtime's exports, because a
 * name missing there can equally be a real defect that SHOULD fail the gate rather than be quietly
 * reclassified.
 */
/**
 * True when the clause containing `index` belongs to a statement that is ALREADY type-only —
 * `import type { … }` / `export type { … }`. Adding a per-name `type` inside one of those is
 * TS2206, not a repair.
 *
 * The per-name guard alone is not enough. It only asks whether `type` sits immediately before the
 * name, which is true of `{ type A, B }` and false of `import type { A, B }` — and the root barrel
 * never exposed the difference, because its clauses are the VALUE form (`export { … } from`).
 * Widening this pass to the subpath entries, whose clauses are `import type { … }`, turned a silent
 * no-op into three TS2206 diagnostics on the first build.
 */
function inTypeOnlyStatement(source, index) {
  const head = source.lastIndexOf("import", index);
  const tail = source.lastIndexOf("export", index);
  const start = Math.max(head, tail);
  if (start === -1) return false;
  const brace = source.indexOf("{", start);
  if (brace === -1 || brace > index) return false;
  return /\b(import|export)\s+type\s*$/.test(source.slice(start, brace));
}

function restoreTypeOnlyExports(source, typeOnlyNames) {
  let out = source;
  let fixed = 0;
  for (const name of typeOnlyNames) {
    const specifier = new RegExp(String.raw`([{,]\s*)${escapeRegExp(name)}(\s*[,}])`, "g");
    out = out.replace(specifier, (match, lead, tail, offset) => {
      // Already `type X`, or `X as Y` — leave both alone.
      if (/\btype\s*$/.test(lead)) return match;
      // The whole statement is already type-only: a per-name modifier there is an error.
      if (inTypeOnlyStatement(out, offset)) return match;
      fixed += 1;
      return `${lead}type ${escapeRegExp(name)}${tail}`;
    });
  }
  return fixed === 0 ? undefined : { source: out, fixed };
}

/** Names the package barrel exports under `export type { … }`. */
function typeOnlyExportNames(pkgDir) {
  const barrel = join(pkgDir, "src", "index.ts");
  if (!existsSync(barrel)) return [];
  const text = readFileSync(barrel, "utf8");
  const names = new Set();
  for (const match of text.matchAll(/export\s+type\s*\{([^}]*)\}/g)) {
    for (const raw of match[1].split(",")) {
      const name = raw
        .trim()
        .split(/\s+as\s+/)[0]
        ?.trim();
      if (name && /^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  return [...names];
}

const target = process.argv[2] ?? ".";
const pkgDir = resolve(process.cwd(), target);
const manifestPath = join(pkgDir, "package.json");
if (!existsSync(manifestPath)) {
  console.error(`[dts-repair] no package.json at ${pkgDir}`);
  process.exit(2);
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

// EVERY declared subpath, not just `exports["."]`. Until 2026-08-20 this read the root entry alone,
// so a package repaired its main declaration and shipped every other one unrepaired —
// `@theokit/sdk-handoff`'s `./internal` entry still had `SDKAgent` and `CustomTool` unbound after a
// clean build, and no gate saw it because `check-dts-typechecks.mjs` had the SAME root-only bias.
// Widening one without the other would have moved the blind spot rather than closed it.
const declaredEntries = [];
for (const [subpath, conditions] of Object.entries(manifest.exports ?? {})) {
  // BOTH conditions. The `.d.cts` is emitted separately from the `.d.ts` and needs the same
  // repair: measured 2026-08-20, `tool-injector.d.ts` carried the bound import while its `.d.cts`
  // sibling still held the bare `import '@theokit/sdk';` this tool exists to fix, because only the
  // `import` condition was ever enumerated. Ten packages published a CJS declaration that did not
  // compile while the ESM half read green.
  const esm = conditions?.import?.types ?? conditions?.types;
  if (typeof esm === "string") declaredEntries.push({ subpath, rel: esm });
  const cjs = conditions?.require?.types;
  if (typeof cjs === "string") declaredEntries.push({ subpath, rel: cjs });
}
if (declaredEntries.length === 0) {
  const legacy = manifest.types ?? manifest.typings;
  if (typeof legacy === "string") declaredEntries.push({ subpath: ".", rel: legacy });
}
if (declaredEntries.length === 0) {
  console.log(
    `[dts-repair] ${manifest.name ?? target}: no published types entry — nothing to check.`,
  );
  process.exit(0);
}

const entryPaths = declaredEntries.map((e) => join(pkgDir, e.rel));
const absent = declaredEntries.filter((e) => !existsSync(join(pkgDir, e.rel)));
if (absent.length > 0) {
  for (const e of absent) {
    console.error(`[dts-repair] ${manifest.name}: declared types entry missing — ${e.rel}`);
  }
  process.exit(1);
}

// Pass 1 — restore `type` modifiers the rollup dropped. Independent of the compiler diagnostics
// below: an over-broad export typechecks fine, it just promises a value the runtime never ships.
const typeOnly = typeOnlyExportNames(pkgDir);
if (typeOnly.length > 0) {
  let restoredTotal = 0;
  for (const entryPath of entryPaths) {
    const restored = restoreTypeOnlyExports(readFileSync(entryPath, "utf8"), typeOnly);
    if (restored === undefined) continue;
    writeFileSync(entryPath, restored.source);
    restoredTotal += restored.fixed;
  }
  if (restoredTotal > 0) {
    console.log(
      `[dts-repair] ${manifest.name}: restored the \`type\` modifier on ${restoredTotal} export(s) ` +
        "the rollup emitted as values (#279 class).",
    );
  }
}

// Pass 2 — bind names the rollup re-exported without importing (#345).
const before = typecheck(entryPaths);
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
    const next =
      bindReExportedName(source, name) ??
      bindExternalName(source, name, pkgDir) ??
      bindSiblingName(source, name, filePath, join(pkgDir, "dist")) ??
      bindAliasedName(source, name);
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

const after = typecheck(entryPaths).filter((line) => /error TS\d+/.test(line));
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
