#!/usr/bin/env node
// Published-declaration typecheck gate — raised by #335.
//
// The `.d.ts` we publish is the only contract a consumer reads before writing a line of code, and
// it can be broken in a way nothing here notices: `skipLibCheck: true` is on by default in most
// consumer projects, so a declaration file that does not compile still installs, still imports, and
// still looks fine — until someone runs type-aware lint, which resolves the real type graph and has
// no such escape. Then every type reached through the broken reference degrades to `error` and the
// consumer gets `no-unsafe-assignment` on ordinary, correct SDK calls.
//
// `tools/check-dts-exports.mjs` already guards two directions of this contract (a re-export must
// resolve to a declaration; a declared value must exist on the `.js`). Both match names as text.
// Measured 2026-08-20 on `@theokit/sdk`: the published entry had SEVEN unresolved references and
// that gate reported none of them, because none was a re-export — they were type references inside
// declaration bodies, from three different mechanisms:
//
//   - `@internal` stripped a type a PUBLIC type still referenced (`MemoryProviderFactory`, #335)
//   - the DTS rollup emitted local declarations naming a symbol it only RE-EXPORTED under an alias
//     (`aw as TokenUsage`) — an `export { … } from` clause does not bind the name locally
//   - module-private names leaked into public signatures (`AgentBuilderDeps`, a `Symbol.for` const)
//
// Three mechanisms, one symptom, and no amount of name-matching finds them all. So this gate does
// not match names: it asks the compiler. `tsc --noEmit` over the published entry, WITHOUT
// `skipLibCheck`, is the same question a consumer's type-aware lint asks, which is the only question
// that matters here.
//
// EVERY DECLARED SUBPATH, not just the root. Until 2026-08-20 this read `exports["."]` alone, so it
// checked 12 entries while the packages publish 45 — `@theokit/sdk` had 32 subpaths outside it. That
// is not a narrower gate, it is a gate aimed away from the damage: `stripInternal` deletes a
// declaration from the emitted `.d.ts` whenever ANY leading comment range contains the literal
// `@internal` — including a file header that no statement separates from the first declaration — and
// the subpath barrel that re-exports it then fails to resolve the name. The root entry does not
// re-export those, so it compiles while `@theokit/sdk/internal/persistence` ships 19 unresolved
// references (#348). The entry a consumer imports is the entry that has to compile.
//
// Attribution is per PACKAGE: one `tsc` invocation takes all of that package's entries as roots, so
// a diagnostic inside a shared chunk cannot be pinned to one subpath. The diagnostic still carries
// its own file path, which is what a fix needs.
//
// Deliberately NOT skipped when `dist/` is missing — see CONTRIBUTING "A silent gate reports absence
// it never checked". A gate whose green can mean "there was nothing to check" is not a gate.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { declaredEntries, ROOT } from "./lib/published-entries.mjs";

/** How many diagnostics to print per package before eliding the rest. */
const MAX_SHOWN = 12;

/**
 * Names this gate tolerates unresolved. **Empty, and it should stay that way.**
 *
 * It held seven for a few hours on 2026-08-20, while the tsup/rollup-plugin-dts defect behind #345
 * had no fix: the rollup emits a symbol as a RE-EXPORT from a chunk and omits it from that chunk's
 * `import`, so a local declaration using the bare name has nothing bound. 51 diagnostics, 10 of 12
 * published packages. `tools/repair-dts-imports.mjs` now binds those names at build time, driven by
 * the compiler's own diagnostics, so there is nothing left to waive.
 *
 * Adding a name here means shipping a declaration that does not compile for a consumer running
 * type-aware lint. It requires proving the same shape AND that the repair cannot bind it — and it
 * is a regression to be removed, not a threshold to be tuned.
 */
const KNOWN_UPSTREAM_UNBOUND = new Set([]);

/** `… error TS2304: Cannot find name 'X'.` / `TS2552: Cannot find name 'X'. Did you mean …` */
const MISSING_NAME = /Cannot find name '([^']+)'/;

function isKnownUpstream(diagnostic) {
  const match = MISSING_NAME.exec(diagnostic);
  return match !== null && KNOWN_UPSTREAM_UNBOUND.has(match[1]);
}

/**
 * EVERY `types` entry a consumer's resolver can land on, read from the package's own `exports` —
 * one per declared subpath, not just `"."`. A package that adds a subpath is covered the moment it
 * declares it; a package that moves an entry moves this gate with it rather than silently dropping
 * out of it.
 *
 * Falls back to the top-level `types`/`typings` only when `exports` declares no typed entry at all,
 * which is the legacy shape.
 */
function typedExportEntries(exportsField) {
  const entries = [];
  for (const [subpath, condition] of Object.entries(exportsField ?? {})) {
    const types = condition?.import?.types ?? condition?.types;
    if (typeof types === "string") entries.push({ subpath, rel: types });
  }
  return entries;
}

function declaredTypesEntries(pkgDir) {
  const manifestPath = join(pkgDir, "package.json");
  if (!existsSync(manifestPath)) return [];
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.private === true) return [];

  const entries = typedExportEntries(manifest.exports);
  if (entries.length > 0) return entries;

  const legacy = manifest.types ?? manifest.typings;
  return typeof legacy === "string" ? [{ subpath: ".", rel: legacy }] : [];
}

const LABEL = "dts-typecheck";

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
    const output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /error TS\d+/.test(line));
  }
}

const byPackage = new Map();
for (const entry of declaredEntries()) {
  byPackage.set(entry.pkg, [...(byPackage.get(entry.pkg) ?? []), entry]);
}

let checked = 0;
let unbuilt = 0;
let waivedTotal = 0;
const failures = [];

for (const [name, entries] of [...byPackage].sort()) {
  const missing = entries.filter((e) => !existsSync(e.typesAbs));
  if (missing.length > 0) {
    for (const e of missing) {
      console.error(
        `[dts-typecheck] ✗ ${name}: declared types entry is missing — ${e.subpath} (${e.condition}) → ${e.typesRel}`,
      );
    }
    unbuilt += missing.length;
    continue;
  }

  const entry = `${entries.length} entr${entries.length === 1 ? "y" : "ies"}`;
  const all = typecheck(entries.map((e) => e.typesAbs));
  const waived = all.filter(isKnownUpstream);
  const diagnostics = all.filter((line) => !isKnownUpstream(line));
  checked += entries.length;
  waivedTotal += waived.length;

  if (diagnostics.length === 0) {
    const note =
      waived.length === 0
        ? ""
        : `  (${waived.length} waived — known upstream rollup defect, see KNOWN_UPSTREAM_UNBOUND)`;
    console.log(`[dts-typecheck] ✓ ${name.padEnd(20)} ${entry}${note}`);
    continue;
  }

  failures.push({ name, entry, diagnostics });
  console.error(`[dts-typecheck] ✗ ${name.padEnd(20)} ${entry} — ${diagnostics.length} error(s)`);
  for (const line of diagnostics.slice(0, MAX_SHOWN)) console.error(`      ${line}`);
  if (diagnostics.length > MAX_SHOWN) {
    console.error(`      … ${diagnostics.length - MAX_SHOWN} more`);
  }
}

if (unbuilt > 0) {
  console.error("");
  console.error(`[dts-typecheck] FAIL — ${unbuilt} declared types entr(ies) do not exist.`);
  console.error(
    "  Run 'pnpm build' first. This gate does not pass on an unbuilt tree: a green that",
  );
  console.error(
    "  can mean 'there was nothing to check' is indistinguishable from one that checked.",
  );
  process.exit(1);
}

if (failures.length > 0) {
  console.error("");
  console.error(
    `[dts-typecheck] FAIL — ${failures.length} package(s) publish a declaration that does not ` +
      `compile, across ${checked} checked entr(ies).`,
  );
  console.error(
    "  `skipLibCheck` hides this from `tsc`; type-aware lint in a consumer project does",
  );
  console.error("  not have that escape. Fix the declaration, never the gate.");
  process.exit(1);
}

console.log("");
// The verdict is deliberately NOT "they compile". While anything is waived, some of them do not —
// saying otherwise here would be the same failure this gate exists to catch, in a louder costume:
// a green line a reader stops at, over a claim the next line contradicts.
console.log(
  waivedTotal === 0
    ? `[dts-typecheck] PASS — ${checked} published declaration(s) compile without skipLibCheck.`
    : `[dts-typecheck] PASS — no NEW unresolved reference in ${checked} published declaration(s). ` +
        "Not the same as 'they compile' — see the waiver below.",
);
// Reported on success, deliberately. A gate that waives something and says nothing is
// indistinguishable from one that found nothing — see CONTRIBUTING, "A silent gate reports
// absence it never checked".
console.log(
  waivedTotal === 0
    ? "[dts-typecheck] nothing waived."
    : `[dts-typecheck] ${waivedTotal} diagnostic(s) WAIVED across ${KNOWN_UPSTREAM_UNBOUND.size} name(s): ` +
        `${[...KNOWN_UPSTREAM_UNBOUND].join(", ")} — tsup/rollup-plugin-dts emits these as a re-export ` +
        "without the matching import. Our source is correct; tsup 8.5.1 is latest. These declarations " +
        "still do not compile for a consumer.",
);
