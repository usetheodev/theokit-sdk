/**
 * `types.ts` is a folder's own types. `<feature>-types.ts` is one feature's, and only when a bare
 * `types.ts` exists beside it to disambiguate from.
 *
 * The convention was already almost universal — sixteen folders used bare `types.ts` — and five
 * repeated their own folder name as a prefix with no bare `types.ts` to distinguish from, so the
 * prefix carried no information and an importer could not predict the path without listing the
 * folder first. Those five were renamed; this keeps the sixth from appearing.
 *
 * The legitimate use is preserved and is what the second half of the rule is for:
 * `internal/llm/` has `types.ts` AND `credential-pool-types.ts`; `internal/memory/` has `types.ts`
 * AND `active-memory-types.ts`. There the prefix says which of two type modules you are opening.
 *
 * `*-contract.ts` is deliberately out of scope. Two files use it — `index-manager-contract.ts`,
 * `agent-registry-contract.ts` — and "contract" denotes a port rather than a bag of types, which is
 * a distinction worth keeping rather than normalising away.
 */
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const SRC_ROOT = join(__dirname, "..", "..", "src");

function walkDirs(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(full);
      walkDirs(full, out);
    }
  }
  return out;
}

describe("types module naming", () => {
  it("scans a tree that has folders and type modules at all", () => {
    // Anti-vacuity: every assertion below filters a listing, and a filter over nothing passes.
    const dirs = walkDirs(SRC_ROOT);
    expect(dirs.length).toBeGreaterThan(20);
    expect(
      dirs.filter((d) => readdirSync(d).includes("types.ts")).length,
      "the bare convention must be present, or this gate is policing an empty set",
    ).toBeGreaterThan(10);
  });
});

/**
 * A prefixed types module in `dir` that has no bare `types.ts` to disambiguate from.
 *
 * A prefixed module BESIDE a bare one is the legitimate shape and returns nothing —
 * `internal/llm/` has `types.ts` and `credential-pool-types.ts`, and the prefix there says which of
 * the two you are opening.
 */
function unjustifiedPrefixedTypesIn(dir: string): string[] {
  const entries = readdirSync(dir);
  if (entries.includes("types.ts")) return [];
  return entries
    .filter((entry) => entry.endsWith("-types.ts"))
    .map((entry) => relative(SRC_ROOT, join(dir, entry)));
}

describe("types module naming — the rule", () => {
  it("no folder has a prefixed types module without a bare types.ts beside it", () => {
    const offenders = [SRC_ROOT, ...walkDirs(SRC_ROOT)].flatMap(unjustifiedPrefixedTypesIn);

    expect(
      offenders,
      offenders.length === 0
        ? ""
        : `These name a types module after their own folder with no bare types.ts to distinguish ` +
            `from, so the prefix carries no information and the path is unpredictable:\n` +
            `${offenders.map((o) => `  src/${o}`).join("\n")}\n` +
            `Rename to types.ts, or add the bare types.ts this one is a feature of.`,
    ).toEqual([]);
  });
});
