#!/usr/bin/env node
// Internal-scoped dead-code gate — closes the knip blind-spot (#131).
//
// knip (the `quality:dead` gate) is configured to IGNORE `src/internal/**`
// (see knip.json — internal has no external npm entry point, so knip's
// entry-reachability model would flag the entire layer). That leaves the
// largest part of the codebase — the internal implementation layer — with
// ZERO dead-code coverage. This gate fills exactly that gap: it flags a
// symbol EXPORTED from any `**/internal/**` module that has NO reference
// anywhere in the repo — not in another file, and not even within its own
// defining file (beyond the definition itself). That is unambiguously dead.
//
// High-signal by design: it does NOT flag "over-exported" symbols (used
// only inside their own file — those are live, just needlessly `export`ed).
// Only truly-dead symbols (0 references, period) fail the build, matching
// the class of orphan the 2026-07-16 dead-code audit found (13 symbols).
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
    if (occ <= 1) orphans.push({ name, file: rel, line: i + 1 });
  }
}

console.log(`internal-deadcode: scanned ${files.length} TS files across packages/*/`);
if (orphans.length === 0) {
  console.log("✓ Internal dead-code gate passed — no orphaned internal exports.");
  process.exit(0);
}
console.error(`✗ Internal dead-code gate FAILED: ${orphans.length} orphaned internal export(s):`);
for (const o of orphans)
  console.error(`  ${o.file}:${o.line}  ${o.name}  (0 references repo-wide)`);
console.error(
  "\nRemove them, or (if intentionally reserved) add the bare name to tools/internal-deadcode-allowlist.txt with a justification comment.",
);
process.exit(1);
