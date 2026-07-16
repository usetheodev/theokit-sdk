#!/usr/bin/env node
// Internal-scoped dead-code gate — closes the knip blind-spot (#131).
//
// knip (the `quality:dead` gate) is configured to IGNORE `src/internal/**`
// (see knip.json — internal has no external npm entry point, so knip's
// entry-reachability model would flag the entire layer). That leaves the
// largest part of the codebase — the internal implementation layer — with
// ZERO dead-code coverage. This gate fills exactly that gap in two passes:
//   Pass 1 — a symbol EXPORTED from any `**/internal/**` module with NO
//            reference anywhere in the repo (not another file, not its own).
//   Pass 2 — a NON-exported top-level `function`/`const` (repo-wide) whose
//            name occurs only once: declared, never used, never exported —
//            the class that hid 8 dead test-seams (knip never sees private
//            symbols; it reasons about exports/files/deps).
//
// High-signal by design: it does NOT flag "over-exported" symbols (used
// only inside their own file — those are live, just needlessly `export`ed).
// Only truly-dead symbols (0 references, period) fail the build, matching
// the two classes the 2026-07-16 dead-code audit found (13 exported + 8
// private, all removed).
//
// Escape hatch: `tools/internal-deadcode-allowlist.txt` — one bare symbol
// name per line (`#` comments allowed) for intentional exceptions (reserved
// migrations, plugin seams loaded reflectively, etc.). Keep it short and
// justified; a growing allowlist is a smell.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const PACKAGES = join(ROOT, "packages");
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "coverage", ".turbo"]);
const IDENT = /[A-Za-z_$][\w$]*/g;
// Matches an exported symbol DEFINITION (not a re-export `export { X } from`).
const EXPORT_DEF =
  /^export\s+(?:async\s+)?(?:(?:declare|abstract)\s+)?(?:function|class|const|let|interface|type|enum)\s+([A-Za-z_$][\w$]*)/;
// Matches a NON-exported top-level function/const/type/interface/enum
// DEFINITION. A private symbol can only be used within its own file, so a single
// occurrence (the declaration itself) means it is unreachable — the class knip
// does not detect (it reasons about exports/files/deps) and the one that hid 8
// dead test-seams the 2026-07-16 audit found. Types/interfaces/enums are here
// too: tsc `noUnusedLocals` covers dead value locals but NOT dead top-level
// private types, so this pass is their only gate.
const PRIVATE_DEF =
  /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|^const\s+([A-Za-z_$][\w$]*)\s*[=:]|^(?:declare\s+)?(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

function loadAllowlist() {
  const f = join(__dirname, "internal-deadcode-allowlist.txt");
  if (!existsSync(f)) return new Set();
  return new Set(
    readFileSync(f, "utf8")
      .split("\n")
      .map((l) => l.replace(/#.*$/, "").trim())
      .filter(Boolean),
  );
}

const files = walk(PACKAGES);
// Per-file identifier set (one pass; used for cross-file reference counting).
const idents = new Map();
const contents = new Map();
for (const f of files) {
  const txt = readFileSync(f, "utf8");
  contents.set(f, txt);
  idents.set(f, new Set(txt.match(IDENT) ?? []));
}

const allowlist = loadAllowlist();
const orphans = [];
for (const f of files) {
  if (!/[/\\]internal[/\\]/.test(f)) continue; // only symbols defined under internal/
  const rel = f.slice(PACKAGES.length + 1);
  const lines = contents.get(f).split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = EXPORT_DEF.exec(lines[i]);
    if (!m) continue;
    const name = m[1];
    if (allowlist.has(name)) continue;
    // external references: name appears in any OTHER file
    let external = false;
    for (const [g, set] of idents) {
      if (g !== f && set.has(name)) {
        external = true;
        break;
      }
    }
    if (external) continue;
    // no external refs — is it used within its own file (beyond the definition)?
    const occ = (contents.get(f).match(new RegExp(`\\b${name}\\b`, "g")) ?? []).length;
    if (occ <= 1)
      orphans.push({ name, file: rel, line: i + 1, why: "exported, 0 references repo-wide" });
  }
}

// Pass 2 — non-exported (private) top-level dead symbols, repo-wide. A bare
// `function`/`const` whose name occurs only once (its own declaration) is
// unreachable: it is not exported (nothing outside the file can use it) and it
// is not called inside the file either. This class is invisible to knip.
for (const f of files) {
  const rel = f.slice(PACKAGES.length + 1);
  const txt = contents.get(f);
  const lines = txt.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("export")) continue;
    const m = PRIVATE_DEF.exec(lines[i]);
    if (!m) continue;
    const name = m[1] ?? m[2] ?? m[3];
    if (!name || allowlist.has(name)) continue;
    // A separate `export { name }` statement would make the word occur >1× in
    // the file; occ<=1 therefore means declared, never used, never exported.
    const occ = (txt.match(new RegExp(`\\b${name}\\b`, "g")) ?? []).length;
    if (occ <= 1)
      orphans.push({ name, file: rel, line: i + 1, why: "private, never used in-file" });
  }
}

console.log(`internal-deadcode: scanned ${files.length} TS files across packages/*/`);
if (orphans.length === 0) {
  console.log(
    "✓ Internal dead-code gate passed — no orphaned internal exports, no dead private symbols.",
  );
  process.exit(0);
}
console.error(`✗ Internal dead-code gate FAILED: ${orphans.length} dead symbol(s):`);
for (const o of orphans) console.error(`  ${o.file}:${o.line}  ${o.name}  (${o.why})`);
console.error(
  "\nRemove them, or (if intentionally reserved) add the bare name to tools/internal-deadcode-allowlist.txt with a justification comment.",
);
process.exit(1);
