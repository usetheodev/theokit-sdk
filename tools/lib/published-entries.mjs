// The published entry points of this workspace, read from each package's own `exports`.
//
// Four gates asked this same question and answered it four times — a copy each in the capability
// map, the error-code reference, the export-parity gate and the coverage gate. The copies drifted
// in the way that matters: three of them read `exports["."]` alone and so covered 12 entries while
// the packages publish 45, and the fix had to be applied to each one separately. One answer, one
// place.
//
// `types` is resolved the way a consumer's resolver would: the `import` condition first, then a
// bare `types`, then the legacy top-level field when `exports` declares no typed entry at all.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const PACKAGES = join(ROOT, "packages");

/**
 * The typed subpath entries a single manifest declares, in declaration order — one row per
 * (subpath, CONDITION).
 *
 * BOTH halves, deliberately. Reading `import.types` alone covered 45 entries while these packages
 * publish 90: every one also declares a `require.types` `.d.cts`. Measured 2026-08-20, the CJS half
 * carried 17 unresolved names — `@theokit/sdk-handoff`'s `tool-injector.d.cts` still held the bare
 * `import '@theokit/sdk';` that its `.d.ts` sibling had been repaired out of — while the gate over
 * the ESM half printed PASS. A consumer resolving the `require` condition (a CJS package under
 * `node16`, ts-node, jest) meets that half and nothing was looking at it.
 *
 * That is the same root-only bias this file was extracted to end, one condition over.
 */
function typedSubpaths(exportsField) {
  const out = [];
  for (const [subpath, conditions] of Object.entries(exportsField ?? {})) {
    const esm = conditions?.import?.types ?? conditions?.types;
    if (typeof esm === "string") out.push({ subpath, condition: "import", typesRel: esm });
    const cjs = conditions?.require?.types;
    if (typeof cjs === "string") out.push({ subpath, condition: "require", typesRel: cjs });
  }
  return out;
}

/** The typed entries of one package directory, `[]` when it publishes none. */
function packageEntries(dir) {
  const manifestPath = join(PACKAGES, dir, "package.json");
  if (!existsSync(manifestPath)) return [];
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.private === true || typeof manifest.name !== "string") return [];

  const declared = typedSubpaths(manifest.exports);
  const legacy = manifest.types ?? manifest.typings;
  const subpaths =
    declared.length > 0
      ? declared
      : typeof legacy === "string"
        ? [{ subpath: ".", condition: "import", typesRel: legacy }]
        : [];

  const pkgDir = join(PACKAGES, dir);
  return subpaths.map(({ subpath, condition, typesRel }) => ({
    pkg: manifest.name,
    dir: pkgDir,
    subpath,
    condition,
    specifier: subpath === "." ? manifest.name : `${manifest.name}${subpath.slice(1)}`,
    typesRel,
    typesAbs: join(pkgDir, typesRel),
  }));
}

/**
 * Every published, typed entry across the workspace, sorted by package directory — both the
 * `import` and the `require` condition of each subpath.
 *
 * Callers that measure the SURFACE (which symbols exist, and are they documented) want one row per
 * subpath and should pass `{ condition: "import" }`: the two conditions publish the same symbols
 * from the same source, so counting both doubles every number without adding a fact. Callers that
 * verify an ARTIFACT (does this file compile, was it repaired) want every row, because the two
 * files are built separately and have been measured to differ.
 */
export function declaredEntries({ condition } = {}) {
  const all = readdirSync(PACKAGES)
    .sort()
    .flatMap((dir) => packageEntries(dir));
  return condition === undefined ? all : all.filter((entry) => entry.condition === condition);
}

/**
 * The source barrel an emitted declaration was built from, by the layout tsup uses here:
 * `./dist/a/b.d.ts` came from `src/a/b.ts` or `src/a/b/index.ts`. `undefined` when neither exists.
 */
export function sourceBarrelFor(entry) {
  const stem = entry.typesRel
    .replace(/^\.\//, "")
    .replace(/^dist\//, "")
    .replace(/\.d\.c?ts$/, "");
  for (const candidate of [`src/${stem}.ts`, `src/${stem}/index.ts`]) {
    const path = join(entry.dir, candidate);
    if (existsSync(path)) return path;
  }
  return undefined;
}
