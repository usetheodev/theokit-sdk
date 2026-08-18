import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Regression harness for the re-release guard (B-109).
 *
 * The incident it prevents already happened, and was caught only because someone looked. On
 * 2026-08-11, cutting a security release, `develop` sat 10 commits behind `main`, still declared
 * `4.40.0`, and still held three changesets that `4.41.0` had consumed. Opening `develop → main`
 * would have re-released three shipped features as fresh minors.
 *
 * So the load-bearing case here is not synthetic: it replays that exact history through the guard
 * and asserts it names those three files. A guard for an incident that cannot be reproduced is a
 * guard nobody can trust.
 */
const REPO = resolve(__dirname, "..", "..", "..");
const guard = await import(join(REPO, "tools", "check-no-reconsumed-changesets.mjs"));

/** The merge that back-merged `main` into `develop` by hand — PR #193, the fix applied that day. */
const BACKMERGE = "337b57b96";

function haveCommit(ref: string): boolean {
  try {
    execFileSync("git", ["cat-file", "-e", `${ref}^{commit}`], { cwd: REPO, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// A shallow clone has no history to ask, and a guard that silently passes for lack of data is worse
// than one that says it could not run.
const historyMissing = !haveCommit(BACKMERGE);

describe.skipIf(historyMissing)("re-release guard — the incident it was written for", () => {
  it("test_the_state_that_would_have_re_released_three_shipped_features_is_refused", () => {
    // `^1` is develop as it stood, `^2` is main as it stood. Reading them off the merge is what
    // makes this a replay of the real state rather than a reconstruction of it.
    const offenders: string[] = guard.reconsumedChangesets(`${BACKMERGE}^2`, `${BACKMERGE}^1`);

    expect(offenders).toHaveLength(3);
    // Named individually, because "three files" would still pass if the guard flagged the wrong
    // three — and these three are the ones B-109's evidence recorded.
    expect(offenders.map((p) => p.replace(".changeset/", "")).sort()).toEqual([
      "answerable-without-reimplementing.md",
      "mcp-server-failed-event.md",
      "sdk-recognises-its-own-artifacts.md",
    ]);
  });

  it("test_the_state_after_the_back_merge_is_accepted", () => {
    // Anti-vacuity, and the proof that the back-merge is the actual remedy: the same comparison one
    // commit later must come back clean, or the guard is simply refusing everything.
    expect(guard.reconsumedChangesets(`${BACKMERGE}^2`, BACKMERGE)).toEqual([]);
  });
});

describe.skipIf(historyMissing)("re-release guard — mechanics", () => {
  it("test_a_changeset_name_main_has_never_deleted_is_not_flagged", () => {
    // `changeset add` generates a fresh random name, so an ordinary new change must never trip
    // this. A name main has deleted is by definition one that already shipped.
    expect(guard.wasDeletedOn(`${BACKMERGE}^2`, ".changeset/a-name-that-never-existed.md")).toBe(
      false,
    );
  });

  it("test_the_upstream_readme_is_not_treated_as_a_changeset", () => {
    // `.changeset/README.md` is Changesets' own documentation. Counting it would make every
    // comparison noisy and eventually get the guard ignored.
    const entries: string[] = guard.changesetsAt(BACKMERGE);
    expect(entries.every((p) => !p.endsWith("README.md"))).toBe(true);
  });

  it("test_a_ref_with_no_changeset_directory_yields_an_empty_list", () => {
    // Must not throw. The guard runs in CI against refs it does not control.
    expect(guard.changesetsAt("4b825dc642cb6eb9a060e54bf8d69288fbee4904")).toEqual([]);
  });
});

describe("re-release guard — a ref is a ref, never an option", () => {
  // The refs reaching this script come from the CI context (`github.base_ref`, the PR head sha),
  // which is pull-request data rather than maintainer input. `execFileSync` rules out SHELL
  // injection — there is no shell — and does nothing about ARGUMENT injection: git reads a value
  // beginning with `-` as a flag, so a branch named `--output=…` would be an option instead of the
  // thing being inspected.
  //
  // The refusal has to be LOUD, which is why these assert a throw rather than an empty result.
  // `changesetsAt` swallows git failures and returns `[]`, and for this guard empty means "all
  // clear" — an injected ref that merely failed would be reported as a clean release.
  const hostile = ["--output=/tmp/pwned", "-n", "--upload-pack=x", ""];

  for (const ref of hostile) {
    it(`test_changesetsAt_refuses_${JSON.stringify(ref)}`, () => {
      expect(() => guard.changesetsAt(ref)).toThrow(/must not be empty or begin with/);
    });

    it(`test_wasDeletedOn_refuses_${JSON.stringify(ref)}`, () => {
      expect(() => guard.wasDeletedOn(ref, ".changeset/x.md")).toThrow(
        /must not be empty or begin with/,
      );
    });
  }

  it("test_an_ordinary_ref_is_still_accepted", () => {
    // Anti-vacuity: the guard must not have become one that refuses everything.
    expect(() => guard.changesetsAt("HEAD")).not.toThrow();
    expect(() => guard.wasDeletedOn("HEAD", ".changeset/x.md")).not.toThrow();
  });
});

/**
 * B-120 — a ref the repository cannot read must REFUSE, never report clean.
 *
 * `changesetsAt` wrapped its `git ls-tree` in a catch that returned `[]`, and for this guard an
 * empty list means "nothing to worry about". So an unreadable ref produced the same output as a
 * genuinely clean one: git printed `fatal: not a tree object` to stderr and the guard printed a
 * tick and exited 0.
 *
 * Third appearance of one shape in this file. The cwd-relative pathspec reported clean from any
 * subdirectory; argument injection was closed by `assertPlainRef`. This one survived both because a
 * well-formed sha the repository does not have is neither malformed nor a bad pathspec.
 *
 * Unreachable in CI today — the job checks out with `fetch-depth: 0` and passes a ref it has. It is
 * reachable by every human running the script locally, which is exactly when someone is deciding
 * whether a release is safe.
 */
describe("re-release guard — an unreadable ref is a refusal, not a pass", () => {
  /** Well-formed, and not in this repository. Deliberately not a random string: a malformed ref is
   *  already refused by `assertPlainRef`, and refusing THAT would prove nothing about this. */
  const ABSENT = "0123456789abcdef0123456789abcdef01234567";

  it("test_a_well_formed_sha_the_repository_does_not_have_is_refused", () => {
    expect(() => guard.changesetsAt(ABSENT)).toThrow(/could not read|not a tree|unresolvable/i);
  });

  it("test_a_ref_that_resolves_and_has_no_changesets_still_reports_clean", () => {
    // The distinction the DoD asks for, and the anti-vacuity floor: throwing for every ref would
    // satisfy the case above while making the guard useless.
    //
    // The EMPTY TREE rather than the repository's first commit. The first version used
    // `rev-list --max-parents=0`, assuming the root predates `.changeset/` — it does not, and the
    // case then listed today's changesets and failed in CI while passing locally. git's empty tree
    // is a constant that resolves everywhere and contains nothing, by construction.
    const emptyTree = execFileSync("git", ["hash-object", "-t", "tree", "/dev/null"], {
      cwd: REPO,
      encoding: "utf8",
    }).trim();

    expect(guard.changesetsAt(emptyTree)).toEqual([]);
  });

  it("test_the_script_exits_2_rather_than_0_for_an_unreadable_ref", () => {
    // Exit code, not just the throw: `main` already distinguishes 2 ("could not check") from 1
    // ("checked, and it is unsafe"). What was missing is anything reaching it.
    let status = 0;
    try {
      execFileSync(
        process.execPath,
        [join(REPO, "tools", "check-no-reconsumed-changesets.mjs"), "origin/main", ABSENT],
        { cwd: REPO, stdio: "pipe" },
      );
    } catch (err) {
      status = (err as { status?: number }).status ?? 0;
    }

    expect(status, "an unreadable ref reported a clean release").toBe(2);
  });
});
