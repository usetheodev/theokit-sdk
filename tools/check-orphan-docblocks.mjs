#!/usr/bin/env node
// Orphaned-docblock gate: a JSDoc block whose next content is ANOTHER JSDoc block.
//
// TypeScript attaches a docblock to the declaration that follows it. When a second block intervenes,
// the first attaches to nothing: the symbol it was written for ships undocumented, and the text
// itself becomes invisible — it is in the source, in no editor tooltip, and in no generated
// reference. `tsc` accepts the shape without a word, which is why it accumulates.
//
// It is an editing accident, not a style choice. Two shapes produce it:
//   - a declaration MOVES to another module and its docblock is left behind (measured on
//     `sdk-tools/git-diff.ts` and `read-file.ts`, both residue of the same M76 refactor);
//   - a new declaration+docblock is INSERTED between an existing docblock and its declaration, so
//     the older text strands (measured on `persistence/transcript-ops.ts`, where the stale version
//     of a doc sat directly above the corrected one that explains it changed).
//
// 41 sites on 2026-08-20, across 3 packages. Two of them would have caused worse than a missing
// doc: relocating the block intact would have carried an `@internal` tag onto an exported symbol
// and DELETED it from the published `.d.ts` (see `check-dts-export-parity.mjs`).
//
// THE PATTERN'S BODY MUST NOT CONTAIN `*/`. A non-greedy `[\s\S]*?\*\/` backtracks: when the
// lookahead fails right after the first `*/`, the engine extends the body to a LATER `*/` that
// satisfies it, so every docblock matches every later docblock across whole declarations. That
// version reported 94 sites, all of them the instrument rather than the code.
//
// A block at file offset 0 is a module header legitimately preceding the first symbol's docblock,
// and is excluded. A header that is NOT at offset 0 still reports — correctly: it is competing for
// attachment, and the fix is to write it as a non-JSDoc comment so it stops.
//
// Usage: node tools/check-orphan-docblocks.mjs

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGES = join(ROOT, "packages");

/** A JSDoc block, then only whitespace, then another JSDoc block. */
const ORPHAN = /\/\*\*(?:[^*]|\*(?!\/))*\*\/[ \t]*\r?\n\s*(?=\/\*\*)/g;

function sources(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) out.push(path);
  }
  return out;
}

const findings = [];
for (const file of sources(PACKAGES).sort()) {
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(ORPHAN)) {
    if (match.index === 0) continue;
    const line = text.slice(0, match.index).split("\n").length;
    const firstText =
      match[0].split("\n").find((l) => /\*\s*\S/.test(l) && !/^\s*\/\*\*/.test(l)) ?? "";
    findings.push({
      file: relative(ROOT, file),
      line,
      text: firstText.replace(/^\s*\*\s?/, "").slice(0, 96),
    });
  }
}

if (findings.length === 0) {
  console.log("[doc-orphans] PASS — no docblock is stranded above another docblock.");
  process.exit(0);
}

console.error(`[doc-orphans] ✗ ${findings.length} orphaned docblock(s):`);
for (const f of findings) console.error(`      ${f.file}:${f.line}  ${f.text}`);
console.error("");
console.error("[doc-orphans] FAIL — each of these attaches to nothing, so the symbol it was");
console.error("  written for ships undocumented and the text ships invisible.");
console.error("  Fix by intent, not mechanically: move the block onto the symbol it describes;");
console.error("  delete it when the block below is the newer, correct version; or write it as a");
console.error("  non-JSDoc comment when it is a section or module header.");
console.error("  Moving a block that carries `@internal` onto an exported symbol DELETES that");
console.error("  symbol from the published .d.ts — drop the tag when relocating.");
process.exit(1);
