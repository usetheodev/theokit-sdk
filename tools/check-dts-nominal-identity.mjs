#!/usr/bin/env node
// Nominal-identity gate: one exported class must not be DECLARED twice across published entries.
//
// TypeScript compares a class with a `private`, `protected` or `#` member NOMINALLY. Two
// declarations of the same class are therefore incompatible types, even when the text is identical.
// When two entry points of one package each emit their own declaration, a consumer combining them —
// the documented combination, in the #361 case — is rejected with "types have separate declarations
// of a private property", an error that names a field and says nothing about import sites.
//
// Measured on `Workflow` (#361): `dist/index.d.ts` typed `CronCreateOptions.workflow` against the
// copy inlined into the shared cron chunk, while `dist/workflow.d.ts` — built by the other DTS
// pipeline — declared its own. `import { Workflow } from "@theokit/sdk/workflow"` plus
// `import { Cron } from "@theokit/sdk"` did not typecheck. Nothing in-tree crosses that boundary,
// because in-tree code imports from `src/`, which is why it survived to a release.
//
// Scope is deliberately the EXPORTS MAP, not `dist/`. Around 30 class names appear in more than one
// `.d.ts` on disk, but most of those files are not reachable by any subpath a consumer can import,
// so no consumer can hold two of them at once. A gate over `dist/` would report ~11 findings that
// cannot be triggered — noise that trains people to ignore it.
//
// A class with no nominal member is exempt: identical structural declarations ARE mutually
// assignable, so a duplicate costs bytes rather than correctness.
//
// Usage: node tools/check-dts-nominal-identity.mjs

import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** `{ import: { types } }` targets of every subpath in a package's exports map. */
function publishedEntries(pkgDir) {
  const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
  const out = [];
  for (const [subpath, value] of Object.entries(pkg.exports ?? {})) {
    const types = value?.import?.types;
    if (typeof types === "string" && types.endsWith(".d.ts")) {
      out.push({ subpath, file: resolve(pkgDir, types) });
    }
  }
  return out;
}

/** Class declarations in `text`, with whether each is compared nominally. */
function classesIn(text) {
  const found = new Map();
  const RE = /^(?:export )?declare class ([A-Za-z_$][\w$]*)[^{]*\{([\s\S]*?)^\}/gm;
  for (const m of text.matchAll(RE)) {
    const body = m[2];
    found.set(m[1], /^\s+(private|protected)\s/m.test(body) || /^\s+#/m.test(body));
  }
  return found;
}

/** `export { X as Name } from './chunk.js'` / `export { Name } from ...` in an entry. */
function reExportSources(text) {
  const out = new Map();
  for (const m of text.matchAll(/export\s*\{([^}]*)\}\s*from\s*['"](\.[^'"]+)['"]/g)) {
    for (const clause of m[1].split(",")) {
      const named = /^\s*(?:type\s+)?([\w$]+)(?:\s+as\s+([\w$]+))?\s*$/.exec(clause);
      if (named !== null) out.set(named[2] ?? named[1], m[2]);
    }
  }
  return out;
}

/** Which FILE actually declares `name` as seen from `entryFile` — the entry, or a chunk it re-exports from. */
function declaringFile(entryFile, name, text) {
  if (classesIn(text).has(name)) return entryFile;
  const from = reExportSources(text).get(name);
  if (from === undefined) return undefined;
  const chunk = resolve(dirname(entryFile), from.replace(/\.js$/, ".d.ts"));
  try {
    return classesIn(readFileSync(chunk, "utf8")).has(name) ? chunk : undefined;
  } catch {
    return undefined;
  }
}

const packages = process.argv.slice(2);
if (packages.length === 0) packages.push(join(ROOT, "packages/sdk"));

const findings = [];
for (const pkgDir of packages) {
  /** name -> [{ subpath, declaredIn, nominal }] */
  const byName = new Map();
  for (const { subpath, file } of publishedEntries(pkgDir)) {
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue; // not built; the build gates report that on their own
    }
    const local = classesIn(text);
    const names = new Set([...local.keys(), ...reExportSources(text).keys()]);
    for (const name of names) {
      const declaredIn = declaringFile(file, name, text);
      if (declaredIn === undefined) continue;
      const nominal = classesIn(readFileSync(declaredIn, "utf8")).get(name) === true;
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push({ subpath, declaredIn, nominal });
    }
  }
  for (const [name, sites] of byName) {
    const files = [...new Set(sites.map((s) => s.declaredIn))];
    if (files.length < 2 || !sites.some((s) => s.nominal)) continue;
    findings.push({
      name,
      sites: sites.map((s) => `${s.subpath} → ${relative(pkgDir, s.declaredIn)}`),
    });
  }
}

if (findings.length === 0) {
  console.log(
    "[dts-identity] PASS — no exported class is declared twice across published entries.",
  );
  process.exit(0);
}

console.error(`[dts-identity] ✗ ${findings.length} class(es) with two published declarations:`);
for (const f of findings) console.error(`      ${f.name}\n        ${f.sites.join("\n        ")}`);
console.error("");
console.error("[dts-identity] FAIL — each of these has a private/protected member, so TypeScript");
console.error(
  "  compares it nominally: a consumer importing the class from one subpath and passing",
);
console.error(
  "  it to an API typed by another gets 'separate declarations of a private property'.",
);
console.error(
  "  Fix at the build layout — emit the class ONCE and have the other entry re-export it",
);
console.error("  (for tsup, that means both entries going through the same DTS pipeline).");
process.exit(1);
