/**
 * Fails the run if the suite left agent or memory state inside the package working tree.
 *
 * MEASURED 2026-09-01, before this existed: `packages/sdk/.theokit/` held **22,671 agent
 * directories, 82,684 session memory files and 1,984 orphaned atomic-write temp files — 540 MB**,
 * with mtimes spanning 2026-05-16 to that morning. The whole life of the checkout. Not one of the
 * 22,671 directories was referenced by `registry.json`, which held a single entry.
 *
 * The cause is a default, not a mistake anyone made once. `Agent.create` and `Agent.getOrCreate`
 * resolve the workspace to `process.cwd()` when given neither `local` nor `cloud`, and during a
 * vitest run that is `packages/sdk` itself — so ~151 call sites across 59 test files persisted real
 * session state into the repository. `THEOKIT_HOME` does not redirect it: the per-project store is
 * `join(cwd, ".theokit")` and `internal/persistence/paths.ts` says the two defaults differ on purpose.
 *
 * WHY IT REACHED SIX FIGURES BEFORE ANYONE NOTICED, and why the gate has to be here rather than in a
 * test file: `.gitignore` excludes `.theokit/`, so it never appeared in `git status`, in a diff, in
 * CI, or in a review. Nothing that a human looks at could show it. And a per-file test cannot see it
 * either — it would run in the middle of the suite and check a directory the other 700 files have
 * not finished writing to. Only a teardown runs after everyone.
 *
 * It is not only hygiene. Any test that lists agents at the process cwd was reading a directory with
 * 22,671 neighbours, so an assertion phrased as a count, or as "the listing contains exactly", was
 * decided by residue from unrelated runs weeks earlier.
 *
 * The check is a DELTA against the baseline taken at setup, not an absolute zero: the tree may
 * legitimately hold a `registry.json`, and demanding a pristine directory would make the gate fire
 * on a state no test created.
 */
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";

const WATCHED = [".theokit/agents", ".theokit/memory/sessions"] as const;

async function snapshot(): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  for (const rel of WATCHED) {
    try {
      out.set(rel, new Set(await readdir(resolve(rel))));
    } catch {
      out.set(rel, new Set()); // absent is the clean state, not an error
    }
  }
  return out;
}

let baseline: Map<string, Set<string>>;

export async function setup(): Promise<void> {
  baseline = await snapshot();
}

export async function teardown(): Promise<void> {
  const after = await snapshot();
  const added: string[] = [];
  for (const rel of WATCHED) {
    const before = baseline.get(rel) ?? new Set<string>();
    for (const name of after.get(rel) ?? new Set<string>()) {
      if (!before.has(name)) added.push(`${rel}/${name}`);
    }
  }
  if (added.length === 0) return;

  // MEASURED 2026-09-01: a teardown that only THROWS does not fail the run. vitest catches it,
  // prints "error during close", and exits 0 — so the first version of this gate reported 82 stray
  // entries and let CI go green over them. That is the same defect this file was written to catch,
  // one layer up, and it is why the exit code is set explicitly rather than trusted to the throw.
  process.exitCode = 1;

  const shown = added.slice(0, 10).join("\n  ");
  throw new Error(
    `The suite wrote ${String(added.length)} new entries into the package working tree:\n  ${shown}` +
      (added.length > 10 ? `\n  … and ${String(added.length - 10)} more` : "") +
      "\n\nA test that creates an agent or enables memory without a temp cwd persists real session " +
      "state into packages/sdk/.theokit/. It is invisible — .gitignore hides it from git status, " +
      "from diffs and from CI — which is how 540 MB accumulated before anyone measured it. Pass " +
      "`local: { cwd: await createTempWorkspace() }` (tests/helpers/temp-workspace.ts, already used " +
      "by 92 files), or clean up in afterEach the way tests/agent-list-cwd.test.ts:129-139 does.",
  );
}
