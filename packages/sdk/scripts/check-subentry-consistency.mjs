#!/usr/bin/env node
// Sub-entry consistency gate — B-101.
//
// Publishing a new `@theokit/sdk` sub-entry needs FOUR coordinated edits:
// `package.json` `exports`, `tsup.config.ts` `entry` (plus the small `dts.entry`
// exemption list), `tsconfig.tools-dts.json` `include`, and
// `scripts/mirror-dts-to-cts.mjs`'s `targets`. Measured 2026-08-19 (B-101): only the
// `tsup.config.ts` entry fails fast when it is missing (nothing to import — the JS
// file is never emitted). Omitting `tsconfig.tools-dts.json` `include` or
// `mirror-dts-to-cts.mjs` `targets` breaks NOTHING visible — the JS still emits,
// `tsc --noEmit` passes, the full suite passes — and the only gate that notices is
// `publint`, roughly ten minutes into the pre-push chain (`pnpm -w run validate`),
// on whoever pushes next.
//
// This script closes that gap by deriving the expected sub-entry set from
// `package.json` `exports` — the source of truth for what is actually published —
// and asserting the other three files agree, BEFORE any build runs. It is wired
// into the root `check` script (fast, pre-commit-level), not `validate`
// (~10-minute, pre-push-level): see root `package.json`.
//
// Six entries are exempt from the `tsconfig.tools-dts.json` / mirror-targets checks:
// whatever `tsup.config.ts`'s own `dts: { entry: {...} } }` block lists. Those use
// tsup's native `rollup-plugin-dts` path, which emits BOTH `.d.ts` and `.d.cts`
// directly — no `tsc` pass, no mirror step, nothing to omit.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SDK_ROOT = join(HERE, "..");

const TOP_ENTRY_START = /\bentry:\s*\{/;
const NATIVE_DTS_ENTRY_START = /\bdts:\s*\{\s*entry:\s*\{/;

/**
 * Parse `key: "value"` pairs out of the FIRST brace-delimited block whose opening
 * matches `blockStartRegex`. Line comments are stripped first so a docblock
 * mentioning `foo: "bar"` in prose cannot be mistaken for a real entry.
 *
 * @param {string} src
 * @param {RegExp} blockStartRegex - must end by matching the block's opening `{`
 * @returns {Record<string, string>}
 */
export function parseEntryBlock(src, blockStartRegex) {
  const stripped = src.replace(/\/\/[^\n]*/g, "");
  const m = blockStartRegex.exec(stripped);
  if (!m) return {};
  let depth = 1;
  let i = m.index + m[0].length;
  while (depth > 0 && i < stripped.length) {
    if (stripped[i] === "{") depth++;
    else if (stripped[i] === "}") depth--;
    i++;
  }
  const body = stripped.slice(m.index + m[0].length, i - 1);
  /** @type {Record<string, string>} */
  const entries = {};
  for (const em of body.matchAll(/["']?([\w./-]+)["']?\s*:\s*["']([^"']+)["']/g)) {
    entries[em[1]] = em[2];
  }
  return entries;
}

/**
 * Parse the `targets = [ ... ]` array in `mirror-dts-to-cts.mjs` into the
 * relative-to-`dist/` path each `join(DIST, ...)` call names.
 *
 * @param {string} src
 * @returns {string[]}
 */
export function parseMirrorTargets(src) {
  const stripped = src.replace(/\/\/[^\n]*/g, "");
  const m = /\btargets\s*=\s*\[/.exec(stripped);
  if (!m) return [];
  let depth = 1;
  let i = m.index + m[0].length;
  while (depth > 0 && i < stripped.length) {
    if (stripped[i] === "[") depth++;
    else if (stripped[i] === "]") depth--;
    i++;
  }
  const body = stripped.slice(m.index + m[0].length, i - 1);
  const targets = [];
  for (const call of body.matchAll(/join\(\s*DIST\s*,([^)]*)\)/g)) {
    const parts = [...call[1].matchAll(/["']([^"']+)["']/g)].map((p) => p[1]);
    if (parts.length > 0) targets.push(parts.join("/"));
  }
  return targets;
}

/**
 * Core check — pure function, no filesystem access, so it is directly unit-testable.
 *
 * @param {object} args
 * @param {Record<string, any>} args.exportsMap - package.json `exports`
 * @param {string} args.tsupSrc - tsup.config.ts source text
 * @param {string[]} args.tsconfigInclude - tsconfig.tools-dts.json `include`
 * @param {string} args.mirrorSrc - mirror-dts-to-cts.mjs source text
 * @returns {{ exportPath: string, entryKey: string, missing: string[] }[]}
 */
/** Extracts the `dist/`-relative `.d.cts` entry key an export declares, or `undefined`. */
function entryKeyOf(exportPath, condition) {
  if (exportPath === "./package.json") return undefined;
  const requireTypes = condition?.require?.types;
  if (typeof requireTypes !== "string" || !requireTypes.startsWith("./dist/")) return undefined;
  if (!requireTypes.endsWith(".d.cts")) return undefined;
  return requireTypes.slice("./dist/".length, -".d.cts".length);
}

/** `true` when `tsconfigInclude` covers `expectedSrc`, literally or via an `"X/**\/*"` glob. */
function isCoveredByTsconfig(tsconfigInclude, expectedSrc) {
  return tsconfigInclude.some((inc) => {
    if (inc === expectedSrc) return true;
    const globMatch = /^(.*)\/\*\*\/\*$/.exec(inc);
    return globMatch !== null && expectedSrc.startsWith(`${globMatch[1]}/`);
  });
}

/** `true` when `mirrorTargets` covers `dtsFile`, as a file target or an ancestor directory. */
function isCoveredByMirror(mirrorTargets, dtsFile) {
  return mirrorTargets.some((t) => t === dtsFile || dtsFile.startsWith(`${t}/`));
}

/** The missing-file messages for one sub-entry, given the three parsed config sources. */
function missingFor(entryKey, { topEntry, nativeDtsEntry, tsconfigInclude, mirrorTargets }) {
  const expectedSrc = `src/${entryKey}.ts`;
  const missing = [];

  if (!(entryKey in topEntry)) {
    missing.push(`tsup.config.ts: entry["${entryKey}"] (expected "${expectedSrc}")`);
  }

  if (entryKey in nativeDtsEntry) return missing; // rollup-plugin-dts emits both files natively

  if (!isCoveredByTsconfig(tsconfigInclude, expectedSrc)) {
    missing.push(`tsconfig.tools-dts.json: include "${expectedSrc}" (or a covering "X/**/*" glob)`);
  }

  const dtsFile = `${entryKey}.d.ts`;
  if (!isCoveredByMirror(mirrorTargets, dtsFile)) {
    missing.push(`scripts/mirror-dts-to-cts.mjs: targets "${dtsFile}" (or a covering directory)`);
  }

  return missing;
}

export function checkSubentryConsistency({ exportsMap, tsupSrc, tsconfigInclude, mirrorSrc }) {
  const config = {
    topEntry: parseEntryBlock(tsupSrc, TOP_ENTRY_START),
    nativeDtsEntry: parseEntryBlock(tsupSrc, NATIVE_DTS_ENTRY_START),
    tsconfigInclude,
    mirrorTargets: parseMirrorTargets(mirrorSrc),
  };

  const problems = [];
  for (const [exportPath, condition] of Object.entries(exportsMap)) {
    const entryKey = entryKeyOf(exportPath, condition);
    if (entryKey === undefined) continue;

    const missing = missingFor(entryKey, config);
    if (missing.length > 0) problems.push({ exportPath, entryKey, missing });
  }

  return problems;
}

// ---- CLI wrapper ----
async function main() {
  const pkg = JSON.parse(readFileSync(join(SDK_ROOT, "package.json"), "utf8"));
  const tsupSrc = readFileSync(join(SDK_ROOT, "tsup.config.ts"), "utf8");
  const tsconfigDts = JSON.parse(readFileSync(join(SDK_ROOT, "tsconfig.tools-dts.json"), "utf8"));
  const mirrorSrc = readFileSync(join(SDK_ROOT, "scripts", "mirror-dts-to-cts.mjs"), "utf8");

  const problems = checkSubentryConsistency({
    exportsMap: pkg.exports ?? {},
    tsupSrc,
    tsconfigInclude: tsconfigDts.include ?? [],
    mirrorSrc,
  });

  if (problems.length === 0) {
    console.log(
      `✓ sub-entry consistency: ${Object.keys(pkg.exports ?? {}).length - 1} exports agree ` +
        "across tsup.config.ts, tsconfig.tools-dts.json, and mirror-dts-to-cts.mjs.",
    );
    process.exit(0);
  }

  console.error(`✗ sub-entry consistency FAILED — ${problems.length} export(s) out of sync:\n`);
  for (const p of problems) {
    console.error(`  ${p.exportPath} (dist/${p.entryKey}.d.cts):`);
    for (const item of p.missing) console.error(`    - ${item}`);
  }
  console.error(
    "\nA new package.json `exports` sub-entry needs matching edits in all three of the " +
      "files above, or it publishes a broken CJS types condition that only `publint` " +
      "catches, ~10 minutes into `pnpm -w run validate`.",
  );
  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
