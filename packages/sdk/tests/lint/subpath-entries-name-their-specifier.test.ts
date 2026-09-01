/**
 * Every published `exports` subpath names itself in its own source file.
 *
 * `src/` is a flat public layer and nothing in it distinguishes the files that ARE published subpaths
 * from the ones only re-exported through `index.ts`. `src/retry.ts` and `src/budget.ts` sit side by
 * side and look identical, yet `@theokit/sdk/retry` resolves and `@theokit/sdk/budget` does not. For a
 * library whose subpath map IS the contract, the only way to tell was to open `package.json`.
 *
 * Several files already carried the line — `retry.ts`, `concurrency.ts`, `path-safety.ts`,
 * `models.ts`, `skills.ts`, `project.ts`, `subagents.ts` — so this makes a partial convention total
 * and keeps it that way. It is a one-line header, and it changes no paths.
 *
 * THE GATE IS THE POINT, not the nine lines it added. A comment convention nobody enforces decays to
 * whichever files someone remembered, which is the state this found.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const PKG_ROOT = join(__dirname, "..", "..");

interface ExportsMap {
  [specifier: string]: unknown;
}

/** The source file a subpath is built from, by the convention this package uses. */
function sourceFor(specifier: string): string | undefined {
  if (specifier === ".") return join(PKG_ROOT, "src", "index.ts");
  const stem = specifier.slice(2);
  for (const candidate of [
    join(PKG_ROOT, "src", `${stem}.ts`),
    join(PKG_ROOT, "src", stem, "index.ts"),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

const exportsMap = (
  JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8")) as { exports: ExportsMap }
).exports;

describe("published subpaths", () => {
  it("finds subpaths to check, and resolves most of them to source", () => {
    // Anti-vacuity, and it also pins the resolution convention: if `src/<stem>.ts` stopped being how
    // a subpath is built, this count would collapse and the assertion below would police nothing.
    const specifiers = Object.keys(exportsMap).filter((s) => s !== "./package.json");
    expect(specifiers.length).toBeGreaterThan(20);
    const resolved = specifiers.filter((s) => sourceFor(s) !== undefined);
    expect(resolved.length).toBeGreaterThan(specifiers.length - 5);
  });
});

/**
 * The specifier a file must name, or `undefined` when this subpath is out of scope.
 *
 * Two subpaths point into a directory the `src/<stem>.ts` convention does not name
 * (`./internal/memory-adapters`, `./internal/memory-store`); they are skipped rather than
 * force-fitted, and the count assertion above bounds how many may be skipped.
 */
function unnamedSpecifier(specifier: string): string | undefined {
  if (specifier === "./package.json") return undefined;
  const source = sourceFor(specifier);
  if (source === undefined) return undefined;
  const head = readFileSync(source, "utf8").split("\n").slice(0, 40).join("\n");
  const publicName = `@theokit/sdk${specifier === "." ? "" : specifier.slice(1)}`;
  return head.includes(publicName) ? undefined : `${specifier} (${source.replace(PKG_ROOT, "")})`;
}

describe("published subpaths — the rule", () => {
  it("every subpath whose source resolves names its own specifier in the file", () => {
    const offenders = Object.keys(exportsMap)
      .map(unnamedSpecifier)
      .filter((x): x is string => x !== undefined);

    expect(
      offenders,
      offenders.length === 0
        ? ""
        : `These files ARE published subpaths and do not say so, so a reader cannot tell them from ` +
            `the modules that are only re-exported through index.ts:\n` +
            `${offenders.map((o) => `  ${o}`).join("\n")}\n` +
            "Add a line naming the specifier to the file's leading docblock.",
    ).toEqual([]);
  });
});
