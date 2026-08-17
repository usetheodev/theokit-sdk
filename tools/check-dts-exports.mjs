#!/usr/bin/env node
// Type/runtime export agreement gate — closes #279 and #280.
//
// The published `.d.ts` files are the contract a consumer reads before writing a
// line of code. Two ways that contract can lie, both of which shipped:
//
//   #279 — the type says a value exists and the runtime does not export it.
//          `import { isValidTaskId } from "@theokit/sdk"` typechecked clean and
//          threw `is not a function` at the call site. The type system, the one
//          thing a consumer trusts to know what exists, asserted the wrong answer.
//
//   #280 — the runtime exports a value and the type does not declare it. The
//          symbol works, arrives untyped, and every call site either casts by
//          hand or trips `no-unsafe-call`. A hand-written cast is a second copy
//          of the signature that diverges silently: `atomicWriteText` is async,
//          the missing declaration hid it, and a caller skipped the `await`.
//
// Both had the same shape and neither had a gate. This is that gate.
//
// DIRECTION 1 — a `.d.ts` re-export must resolve to a declaration.
//   Root cause of #280: `stripInternal: true` (tsconfig.base.json) deletes the
//   declaration of anything tagged `@internal`, while a public barrel goes on
//   naming it in `export { ... } from`. The tag and the re-export disagreed and
//   nothing noticed. One of them even read `@internal — public via
//   @theokit/sdk/path-safety`, contradicting itself on one line.
//
// DIRECTION 2 — a value exported by a `.d.ts` entry must exist on the `.js`.
//   Root cause of #279: the DTS rollup hoists symbols out of the type graph and
//   re-exports them even when the runtime barrel never did.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(HERE, "../packages/sdk/dist");

const DECLARES =
  /\b(?:declare\s+(?:function|const|let|var|class|abstract\s+class)|interface|type|enum|namespace)\s+([A-Za-z_$][\w$]*)/g;
const REEXPORT = /export\s*\{([^}]*)\}\s*from\s*["'](\.[^"']+)["']/gs;
/** A rollup output chunk: `<name>-<hash>.js`. Build artefact, not the contract. */
const CHUNK = /-[A-Za-z0-9_-]{8}\.js$/;

/**
 * Known disagreements the SOURCE already gets right and the DTS rollup breaks.
 *
 * Keep this list at zero-or-explained. An entry is a promise that someone read the
 * source and confirmed the intent is correct — not a way to quiet the gate.
 */
const KNOWN = new Map([
  [
    "index.d.ts:LiveAgentRegistry",
    "src/index.ts exports it under `export type { ... }` with a comment saying so — the " +
      "runtime singleton is reached via `Agent.registry`, deliberately. rollup-plugin-dts " +
      "drops the `type` modifier when it flattens the bundle and emits `declare class`, so " +
      "the published .d.ts offers a constructor the runtime never exports. Fixing it means " +
      "post-processing the bundled .d.ts or changing DTS generators; the source is not wrong.",
  ],
]);

/** Names a `.d.ts` declares locally. */
function declaredIn(file) {
  const names = new Set();
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(DECLARES)) names.add(m[1]);
  // `export { X } from "..."` also satisfies a downstream re-export of X.
  for (const m of text.matchAll(REEXPORT)) {
    for (const part of m[1].split(",")) {
      const n = part
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)
        .pop()
        ?.trim();
      if (n) names.add(n);
    }
  }
  return names;
}

let problems = [];

// ── Direction 1: every value re-export resolves to a declaration ───────────
for (const entry of readdirSync(DIST).filter((f) => f.endsWith(".d.ts"))) {
  const file = join(DIST, entry);
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(REEXPORT)) {
    // Skip rollup chunks (`name-8charHash.js`). Their `.d.ts` uses minified
    // single-letter aliases, so a name check there compares build artefacts
    // rather than the contract. Only hand-authored module paths are the contract.
    if (CHUNK.test(m[2])) continue;
    const targetRel = m[2].replace(/\.js$/, ".d.ts");
    const target = resolve(dirname(file), targetRel);
    if (!existsSync(target)) continue; // resolved elsewhere; not this gate's business
    const declared = declaredIn(target);
    for (const part of m[1].split(",")) {
      const raw = part.trim();
      if (!raw || raw.startsWith("type ")) continue; // type-only: erased anyway
      const name = raw.split(/\s+as\s+/)[0].trim();
      if (name && !declared.has(name)) {
        problems.push({
          kind: "declared-nowhere",
          entry,
          name,
          detail: `re-exported from ${m[2]}, which declares no such symbol (stripInternal?)`,
        });
      }
    }
  }
}

// ── Direction 2: every value a `.d.ts` entry exports exists on its `.js` ───
const entries = readdirSync(DIST).filter(
  (f) => f.endsWith(".d.ts") && existsSync(join(DIST, f.replace(/\.d\.ts$/, ".js"))),
);

for (const entry of entries) {
  const dts = readFileSync(join(DIST, entry), "utf8");
  const jsPath = join(DIST, entry.replace(/\.d\.ts$/, ".js"));

  // The final flat `export { ... };` list of a bundled entry.
  const finalExports = [...dts.matchAll(/export\s*\{([^}]*)\}\s*;/g)].at(-1);
  if (!finalExports) continue;

  // Only VALUES matter here. A bundled `.d.ts` legitimately lists an interface or
  // type alias without the `type` modifier — TypeScript resolves it as a type and
  // nothing is emitted or expected at runtime. The lie is a symbol declared with
  // `declare function|const|class` that the `.js` never exports: that one compiles
  // and then throws at the call site.
  const valueNames = new Set(
    [
      ...dts.matchAll(
        /\bdeclare\s+(?:function|const|let|var|class|abstract\s+class)\s+([A-Za-z_$][\w$]*)/g,
      ),
    ].map((m) => m[1]),
  );

  const wanted = finalExports[1]
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith("type "))
    .map((s) => (s.split(/\s+as\s+/).pop() ?? "").trim())
    .filter((n) => n && valueNames.has(n));
  if (wanted.length === 0) continue;

  let runtime;
  try {
    runtime = await import(pathToFileURL(jsPath).href);
  } catch (err) {
    problems.push({ kind: "unimportable", entry, name: "-", detail: String(err).slice(0, 120) });
    continue;
  }

  for (const name of wanted) {
    if (!(name in runtime)) {
      problems.push({
        kind: "type-only-lie",
        entry,
        name,
        detail: "declared as a VALUE in the .d.ts, absent from the .js at runtime",
      });
    }
  }
}

const known = problems.filter((p) => KNOWN.has(`${p.entry}:${p.name}`));
problems = problems.filter((p) => !KNOWN.has(`${p.entry}:${p.name}`));

for (const p of known) {
  console.log(`· known: ${p.entry}: ${p.name}`);
  console.log(`    ${KNOWN.get(`${p.entry}:${p.name}`)}`);
}

if (problems.length === 0) {
  console.log(
    `✓ dts/runtime export agreement: ${entries.length} entries, no new disagreement` +
      (known.length > 0 ? ` (${known.length} known).` : "."),
  );
  process.exit(0);
}

console.error(`✗ dts/runtime export agreement FAILED — ${problems.length} disagreement(s):\n`);
for (const p of problems) {
  console.error(`  [${p.kind}] ${p.entry}: ${p.name}`);
  console.error(`      ${p.detail}`);
}
console.error(
  "\nFix, by kind:\n" +
    "  declared-nowhere — the symbol is re-exported by a public barrel but its docblock\n" +
    "                     carries @internal, and stripInternal deletes the declaration.\n" +
    "                     Drop the tag (it is public) or drop the re-export (it is not).\n" +
    "  type-only-lie    — the .d.ts promises a value the runtime never exports. Either\n" +
    "                     export it for real from the entry, or stop declaring it.\n",
);
process.exit(1);
