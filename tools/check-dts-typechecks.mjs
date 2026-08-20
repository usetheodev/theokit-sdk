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
// Deliberately NOT skipped when `dist/` is missing — see CONTRIBUTING "A silent gate reports absence
// it never checked". A gate whose green can mean "there was nothing to check" is not a gate.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const PACKAGES = join(ROOT, "packages");

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
 * The `types` entry a consumer's resolver would land on, read from the package's own `exports`
 * rather than assumed to be `dist/index.d.ts`. A package that moves its entry should move this
 * gate with it, not silently drop out of it.
 */
function declaredTypesEntry(pkgDir) {
  const manifestPath = join(pkgDir, "package.json");
  if (!existsSync(manifestPath)) return undefined;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.private === true) return undefined;
  const root = manifest.exports?.["."];
  const entry = root?.import?.types ?? root?.types ?? manifest.types ?? manifest.typings;
  return typeof entry === "string" ? entry : undefined;
}

function typecheck(entryPath) {
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
        entryPath,
      ],
      { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return [];
  } catch (error) {
    const output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /error TS\d+/.test(line));
  }
}

const pkgNames = readdirSync(PACKAGES, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

let checked = 0;
let unbuilt = 0;
let waivedTotal = 0;
const failures = [];

for (const name of pkgNames) {
  const pkgDir = join(PACKAGES, name);
  const entry = declaredTypesEntry(pkgDir);
  if (entry === undefined) continue;

  const entryPath = join(pkgDir, entry);
  if (!existsSync(entryPath)) {
    console.error(`[dts-typecheck] ✗ ${name}: declared types entry is missing — ${entry}`);
    unbuilt += 1;
    continue;
  }

  const all = typecheck(entryPath);
  const waived = all.filter(isKnownUpstream);
  const diagnostics = all.filter((line) => !isKnownUpstream(line));
  checked += 1;
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
  console.error(
    `[dts-typecheck] FAIL — ${unbuilt} package(s) declare a types entry that does not exist.`,
  );
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
    `[dts-typecheck] FAIL — ${failures.length} of ${checked} published declaration(s) do not compile.`,
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
