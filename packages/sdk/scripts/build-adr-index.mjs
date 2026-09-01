#!/usr/bin/env node
/**
 * Regenerates `docs/adr/README.md` from the D-series citations in `src/`.
 *
 * The index is DERIVED, never authored. `src/` cites the D-series hundreds of times and none of those
 * citations resolved to anything in this repository — there is no `docs/adr/` in git and never was —
 * so a comment reading "per ADR D135" pointed nowhere.
 *
 * What this does NOT do is summarise the decisions. Writing a one-line description per D-number means
 * paraphrasing a justification you did not make, from a comment that only cites it, and a paraphrase of
 * a justification is a new claim. It locates them instead: every citing site, and the longest citing
 * line verbatim.
 *
 * Only COMMENT lines are scanned. A `D` followed by digits inside code is an identifier.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, "..");
const SRC = join(PKG, "src");
const OUT = join(PKG, "docs", "adr", "README.md");

const CITE = /(?<![A-Za-z0-9])(D\d{1,3})(?![A-Za-z0-9])/g;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".ts")) out.push(full);
  }
  return out;
}

/** A comment line with its markers stripped, or `undefined` when the line is code. */
function commentText(raw) {
  const line = raw.trim();
  if (!(line.startsWith("*") || line.startsWith("//") || line.startsWith("/*"))) return undefined;
  return line.replace(/^[*/ ]+/, "").trim();
}

/** D-number -> [{ file, line, text }], from comment lines only. */
export function collectCitations(root = SRC) {
  const hits = new Map();
  for (const file of walk(root)) {
    const rel = relative(PKG, file).split("\\").join("/");
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((raw, index) => {
        const text = commentText(raw);
        if (text === undefined) return;
        for (const m of text.matchAll(CITE)) {
          const key = m[1];
          if (!hits.has(key)) hits.set(key, []);
          hits.get(key).push({ file: rel, line: index + 1, text });
        }
      });
  }
  return hits;
}

function render(hits) {
  const total = [...hits.values()].reduce((n, v) => n + v.length, 0);
  const head = `# ADR index (D-series)

> **Generated, never hand-written.** Every line below is derived from the citations in \`src/\`.
> Regenerate with \`node scripts/build-adr-index.mjs\`, and \`tests/lint/adr-index-covers-citations.test.ts\`
> fails when a cited D-number is missing from it.

\`src/\` cites the D-series **${total} times across ${hits.size} distinct decisions**, and those citations
carry real load — \`internal/runtime/concurrency/async-semaphore.ts\` justifies not depending on
\`p-limit\` by ADR D135, \`security.ts\` anchors its two-entry-point design on D68. None of them resolved
to anything in this repository: there is no \`docs/adr/\` in git and never was.

**This index does not restate the decisions — it locates them.** Writing a one-line summary per
D-number would mean paraphrasing 244 decisions from the comments that cite them, and a paraphrase of a
justification is a new claim. What is here is derived and checkable: for each number, every place it is
invoked and the citing line verbatim. A reader who meets \`ADR D135\` in a comment can now find every
other place that decision is load-bearing, and read what each one says it decided.

Full ADR bodies can follow incrementally. Until then, the citations resolve.

`;
  const body = [...hits.keys()]
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
    .map((key) => {
      const sites = hits.get(key);
      const longest = sites.reduce((a, b) => (b.text.length > a.text.length ? b : a));
      return [
        `## ${key}`,
        "",
        `> ${longest.text}`,
        "",
        `Cited at ${sites.length} site${sites.length === 1 ? "" : "s"}:`,
        "",
        ...sites.map((s) => `- \`${s.file}:${s.line}\``),
        "",
      ].join("\n");
    })
    .join("\n");
  return `${head}\n${body}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(OUT, render(collectCitations()));
  const hits = collectCitations();
  process.stdout.write(
    `[adr-index] ${hits.size} decisions, ${[...hits.values()].reduce((n, v) => n + v.length, 0)} sites -> ${relative(PKG, OUT)}\n`,
  );
}
