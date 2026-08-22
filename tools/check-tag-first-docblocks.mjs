#!/usr/bin/env node
// Tag-first-docblock gate: a JSDoc block whose FIRST content line begins with an unknown `@tag`.
//
// TypeScript parses a docblock as [description][tags]. When the first line is `@something`, there is
// no description — the entire block becomes the value of that tag. `getDocumentationComment()`
// returns `[]`, so every consumer of it (editor tooltips, TypeDoc, this repo's own doc-coverage
// instrument) reports the symbol as undocumented, while the `.d.ts` visibly carries the comment.
// Nobody deleted the text; TypeScript filed it under a tag nobody reads.
//
// Measured on `server/auth/validate-return-to.ts`, whose block opened with
// `@theokit/sdk/server/auth — same-origin returnTo validator`. TypeScript invented a tag named
// `theokit` and consumed the block as its comment; doc-coverage listed `validateReturnTo` as an
// undocumented export of an entry point whose file plainly documents it. `tsc` and Biome both
// accept the shape without a word, which is why it accumulates (#366).
//
// Only a LINE-INITIAL `@` does this. `Clamp a thing (`@theokit/sdk/server/auth`)` on line 1 is fine,
// which is the shape the fix takes: put a sentence first and the module path inside it.
//
// A KNOWN tag first is legitimate and must not be flagged: `@internal` / `@public` alone is how a
// visibility-only block is written, `@packageDocumentation` is the canonical module header, and
// `@deprecated`-first is a real convention. Those tags are ones TypeScript actually knows, so the
// block behaves as intended. The failure is specifically an INVENTED tag — the block reads as
// documentation to a human and as a tag value to every tool.
//
// Usage: node tools/check-tag-first-docblocks.mjs

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGES = join(ROOT, "packages");

/**
 * Tags TypeScript, TSDoc and the JSDoc dialects in use here recognise. A block opening with one of
 * these is deliberate; a block opening with anything else has had its text eaten.
 */
const KNOWN_TAGS = new Set([
  "alpha",
  "author",
  "beta",
  "callback",
  "category",
  "constructor",
  "default",
  "defaultValue",
  "deprecated",
  "enum",
  "eventProperty",
  "example",
  "experimental",
  "extends",
  "file",
  "fileoverview",
  "group",
  "ignore",
  "inheritDoc",
  "internal",
  "label",
  "license",
  "link",
  "module",
  "override",
  "packageDocumentation",
  "param",
  "private",
  "property",
  "protected",
  "public",
  "readonly",
  "remarks",
  "returns",
  "sealed",
  "see",
  "since",
  "template",
  "throws",
  "todo",
  "type",
  "typeParam",
  "typedef",
  "virtual",
  "yields",
]);

/** A whole JSDoc block. The body must not contain `*​/`, or the match runs past the block's end. */
const DOCBLOCK = /\/\*\*(?:[^*]|\*(?!\/))*\*\//g;

function sources(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) out.push(path);
  }
  return out;
}

/** The block's first line carrying anything other than the opening `/**`. */
function firstContentLine(block) {
  for (const raw of block.split("\n").slice(1)) {
    const line = raw.replace(/^\s*\*\s?/, "").trim();
    if (line !== "" && line !== "/") return line;
  }
  return "";
}

const findings = [];
for (const file of sources(PACKAGES).sort()) {
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(DOCBLOCK)) {
    const first = firstContentLine(match[0]);
    const tag = /^@([A-Za-z][\w-]*)/.exec(first);
    if (tag === null || KNOWN_TAGS.has(tag[1])) continue;
    findings.push({
      file: relative(ROOT, file),
      line: text.slice(0, match.index).split("\n").length,
      tag: tag[1],
      text: first.slice(0, 84),
    });
  }
}

if (findings.length === 0) {
  console.log("[tag-first-docs] PASS — no docblock opens with an unknown tag.");
  process.exit(0);
}

console.error(`[tag-first-docs] ✗ ${findings.length} docblock(s) opening with an unknown tag:`);
for (const f of findings) console.error(`      ${f.file}:${f.line}  @${f.tag} …  ${f.text}`);
console.error("");
console.error(
  "[tag-first-docs] FAIL — TypeScript reads each of these as a tag, not a description,",
);
console.error("  so the whole block becomes that tag's value and the symbol ships undocumented");
console.error("  while the source plainly documents it.");
console.error("  Fix: open with a sentence and put the path inside it —");
console.error("    `Same-origin returnTo validator for `@theokit/sdk/server/auth`.`");
console.error("  A mid-line `@` is safe; only a line-initial one is parsed as a tag.");
process.exit(1);
