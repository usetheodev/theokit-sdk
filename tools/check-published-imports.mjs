#!/usr/bin/env node
// Published-import gate: every declared subpath must LOAD from a fresh install, outside this repo.
//
// The suites in this repository all run inside the pnpm workspace, where every peer dependency is
// hoisted into `node_modules` whether or not the package declares it as one. So a package can
// require something at module scope, never declare it as a dependency, and pass every gate here —
// while failing on the first line of its own quickstart for anyone who installs it.
//
// Measured on `@theokit/sdk@4.56.0`, live on npm as `latest` (#399):
//
//     $ npm install @theokit/sdk@4.56.0        # 3 packages: croner, jsonrepair, @theokit/sdk
//     $ node -e 'import("@theokit/sdk")'
//     Error: Cannot find package 'zod'
//
// `zod` was a peer dependency marked OPTIONAL, so npm correctly did not install it — while 28
// published files imported it statically, including the root entry of both module systems.
//
// `publint` and `attw` do not catch this: they check the packaging contract and type resolution,
// not whether the code can be evaluated with only what a consumer actually receives. The one thing
// that catches it is installing the tarball somewhere that is not this workspace.
//
// Usage: node tools/check-published-imports.mjs [package-dir]

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The subpaths a consumer can import, from an exports map.
 *
 * Pure, so the parsing is testable without packing anything. `./package.json` is excluded: it
 * resolves to JSON, and importing it proves nothing about whether the code loads.
 */
export function importableSubpaths(exportsMap) {
  return Object.entries(exportsMap ?? {})
    .filter(([subpath, value]) => {
      if (subpath.endsWith("package.json") || subpath.includes("*")) return false;
      return typeof value?.import?.default === "string";
    })
    .map(([subpath]) => subpath)
    .sort();
}

/** `@scope/name` + subpath → the specifier a consumer writes. */
export function specifierFor(name, subpath) {
  return subpath === "." ? name : `${name}${subpath.slice(1)}`;
}

function main() {
  const pkgDir = resolve(process.argv[2] ?? join(ROOT, "packages/sdk"));
  const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
  const subpaths = importableSubpaths(pkg.exports);

  const scratch = mkdtempSync(join(tmpdir(), "published-imports-"));
  try {
    const packed = execFileSync("npm", ["pack", "--silent", "--pack-destination", scratch], {
      cwd: pkgDir,
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .pop();

    writeFileSync(
      join(scratch, "package.json"),
      JSON.stringify({ name: "consumer", private: true, type: "module" }),
    );
    // `--ignore-scripts`: a consumer's install may run them, but this gate is about module loading,
    // and a native postinstall would make it fail for a reason it is not testing.
    execFileSync(
      "npm",
      ["install", join(scratch, packed), "--ignore-scripts", "--no-audit", "--no-fund", "--silent"],
      {
        cwd: scratch,
        encoding: "utf8",
        stdio: "pipe",
      },
    );

    const probe = join(scratch, "probe.mjs");
    writeFileSync(
      probe,
      `${subpaths
        .map(
          (s, i) =>
            `try { await import(${JSON.stringify(specifierFor(pkg.name, s))}); } catch (e) { console.log(${JSON.stringify(
              s,
            )} + "\\t" + (e && e.message ? e.message.split("\\n")[0] : String(e))); }`,
        )
        .join("\n")}\n`,
    );
    const failures = execFileSync("node", [probe], { cwd: scratch, encoding: "utf8" }).trim();

    if (failures === "") {
      console.log(
        `[published-imports] PASS — all ${subpaths.length} declared subpath(s) load from a fresh install of ${pkg.name}.`,
      );
      return 0;
    }

    const rows = failures.split("\n");
    console.error(
      `[published-imports] ✗ ${rows.length} subpath(s) do not load from a fresh install:`,
    );
    for (const row of rows) {
      const [sub, message] = row.split("\t");
      console.error(`      ${sub}\n        ${message}`);
    }
    console.error("");
    console.error("[published-imports] FAIL — this is what a consumer gets from `npm install`, so");
    console.error("  the package is broken for them however green this repository is. Every suite");
    console.error(
      "  here runs inside the workspace, where peers are hoisted and the gap is invisible.",
    );
    console.error("");
    console.error("  A module-scope import of something declared OPTIONAL is the usual cause: npm");
    console.error("  honours the declaration and does not install it. Either move it to");
    console.error(
      "  `dependencies`, or make the import genuinely lazy behind the paths that need it.",
    );
    return 1;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main());
