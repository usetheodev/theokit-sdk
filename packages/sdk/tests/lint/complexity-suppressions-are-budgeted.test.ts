import { readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

const SRC_ROOT = join(__dirname, "..", "..", "src");

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  const { readdir, stat } = await import("node:fs/promises");
  for (const name of await readdir(dir)) {
    const full = join(dir, name);
    if ((await stat(full)).isDirectory()) await walk(full, out);
    else if (full.endsWith(".ts")) out.push(full);
  }
  return out;
}

const TAG = "biome-ignore lint/complexity/noExcessiveCognitiveComplexity";

/**
 * A suppression that defers rather than argues, with no sunset, is indistinguishable from disabling
 * the rule at that site.
 *
 * `biome.json` sets `noExcessiveCognitiveComplexity` to error at 10 — stricter than SonarQube's 15,
 * so it is a gate the team chose deliberately. Every suppression in `src/` carries a written reason,
 * which is genuinely unusual and is why the complexity dimension of the audit that produced this file
 * was not a list of surprises. What was missing is a BUDGET: nothing recorded the count or stopped it
 * growing, while the repo's sibling mechanism (`tools/check-duplication.mjs`) pins an exact figure and
 * asks to be re-pinned downward.
 *
 * Two populations, needing opposite treatment:
 *
 *   ARGUED — names a specific reason tied to that function: an RFC state machine, a coercion ladder,
 *   a strategy dispatch. These are considered exemptions and are not the problem.
 *
 *   DEFERRING — the same paragraph pasted verbatim ("PRE-EXISTING debt ... Tracked in
 *   usetheodev/theokit-sdk#151", "refactor candidate", "see the reason just above"). A waiver that
 *   points at an open issue with no sunset and no per-site claim.
 *
 * Both are capped at today's measurement. The deferring cap is the one that should fall: closing #151
 * for a function, or writing a reason about THAT function, moves a suppression from one population to
 * the other and both numbers want re-pinning.
 *
 * WHAT THIS DOES NOT CHECK: whether an argued reason is a GOOD one. `pv 2` says so about the same
 * mechanism, and it is why the file that carries the weakest argument in this package was filed on
 * its substance rather than on the presence of the tag.
 */
// Re-pinned to 65 from 66 when `refreshModelCatalog` was split into the four steps its own
// suppression named — kill-switch, TTL gate, fetch, persist+patch — each keeping the fallback it
// owns. Note it did NOT move MAX_DEFERRING: that suppression argued its own case, it just argued
// for a function that no longer needs one.
const MAX_TOTAL = 65;
// Re-pinned from 24 the first time the budget was set: four suppressions in the provider catalog
// traded "see the reason just above" for an argument about their own function. That is the movement
// this number exists to record — a cap that never moves is a cap nobody is working against.
const MAX_DEFERRING = 20;
const DEFERS = /PRE-EXISTING|Tracked in|refactor candidate|see the reason just above|#151/i;

describe("complexity suppressions are budgeted, not merely explained", () => {
  let all: Array<{ where: string; reason: string }> = [];

  beforeAll(async () => {
    const files = await walk(SRC_ROOT);
    all = files.flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .map((line, i) => ({ line, i }))
        .filter(({ line }) => line.includes(TAG))
        .map(({ line, i }) => ({
          where: `${relative(SRC_ROOT, file).split("\\").join("/")}:${i + 1}`,
          reason: line.split(`${TAG}:`)[1]?.trim() ?? "",
        })),
    );
  });

  it("every suppression carries a written reason — the property already true, now held", () => {
    expect(
      all.length,
      "the scan found no suppressions; the tag or the walk changed",
    ).toBeGreaterThan(40);
    expect(all.filter((s) => s.reason === "").map((s) => s.where)).toEqual([]);
  });

  it(`there are no more than ${MAX_TOTAL} of them`, () => {
    expect(
      all.length,
      `${all.length} suppressions against a pinned budget of ${MAX_TOTAL}. If the count DROPPED, ` +
        "re-pin this number downward — that is how the budget ratchets. If it rose, the new site " +
        "needs to argue its own case, not join a pile.",
    ).toBeLessThanOrEqual(MAX_TOTAL);
  });

  it(`no more than ${MAX_DEFERRING} defer instead of arguing`, () => {
    const deferring = all.filter((s) => DEFERS.test(s.reason));
    expect(
      deferring.length,
      `${deferring.length} suppressions defer to an issue or call themselves a refactor candidate, ` +
        `against a pinned ${MAX_DEFERRING}. This is the number that should fall: give the ` +
        "suppression a reason about ITS function, or close the issue for it. An undated blanket " +
        "waiver is indistinguishable from disabling the rule.",
    ).toBeLessThanOrEqual(MAX_DEFERRING);
  });
});
