import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

/**
 * Regression harness for the `.githooks/pre-push` skip added for B-113.
 *
 * The hook now exits early when a push introduces no new commit — the release case, where a tag
 * points at a commit origin already has and the full ten-minute `validate` re-checks a tree that
 * was already checked by the push that carried it.
 *
 * A gate that learned to skip itself needs its DANGEROUS direction pinned, not its convenient one.
 * The convenient direction failing costs ten minutes; the dangerous direction failing means
 * unvalidated code reaches origin. So the cases below are weighted accordingly: one asserts the
 * skip, four assert that the gate still runs — a branch with new commits, a NEW tag on a new
 * commit, a mixed push where only one ref is new, and the fail-safe when git says nothing.
 *
 * Shelling out to the real hook follows `claude-hooks-gates.test.ts`: a matcher reimplemented in
 * TypeScript would pass while the shell that actually runs stays broken.
 *
 * `pnpm` is stubbed rather than run, because "did the gate execute?" is the whole question and the
 * real gate takes minutes. The stub writes a marker; its presence IS the assertion. `HOME` is
 * redirected at the same time so the hook's `nvm.sh` sourcing cannot re-order PATH and shadow the
 * stub — a test whose subject can be silently replaced is not testing anything.
 */
const REPO = join(__dirname, "..", "..", "..");
const HOOK = join(REPO, ".githooks", "pre-push");

const sandbox = mkdtempSync(join(tmpdir(), "prepush-"));
afterAll(() => rmSync(sandbox, { recursive: true, force: true }));

/**
 * Run git against this repository, with an identity supplied rather than inherited.
 *
 * `git commit-tree` below writes an object and therefore demands an author, and a CI runner has
 * none — `actions/checkout` sets no `user.name` / `user.email`. Without these flags git exits 128
 * with "Author identity unknown", `execFileSync` turns that into a throw, and because the call sits
 * in the describe body the whole FILE fails to collect rather than one case failing.
 *
 * That is exactly how this landed red in CI while green on a developer machine, where an ambient
 * `~/.gitconfig` quietly supplied the answer. Reproduced by scrubbing `HOME` and `GIT_CONFIG_*`:
 * without the flags the file collects nothing, with them all five cases pass.
 *
 * The identity is fixed here rather than read from anywhere, so the test depends on machine
 * configuration in neither direction.
 */
function git(...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.name=theokit-test", "-c", "user.email=test@theokit.invalid", ...args],
    { cwd: REPO, encoding: "utf8" },
  ).trim();
}

/**
 * Run the real hook with `refLines` on stdin.
 *
 * @returns whether the hook reached `pnpm` — i.e. whether the gate ran.
 */
function gateRan(refLines: string): boolean {
  const home = mkdtempSync(join(sandbox, "home-"));
  const bin = join(home, "bin");
  mkdirSync(bin);
  const marker = join(home, "gate-reached");
  writeFileSync(
    join(bin, "pnpm"),
    `#!/usr/bin/env bash\ntouch ${JSON.stringify(marker)}\nexit 0\n`,
    {
      mode: 0o755,
    },
  );

  execFileSync("bash", [HOOK], {
    cwd: REPO,
    input: refLines,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      HOME: home,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      // The hook's own CI escape would short-circuit before the branch under test.
      CI: "",
      GITHUB_ACTIONS: "",
    },
  });

  return existsSync(marker);
}

const ZERO = "0".repeat(40);
const hookMissing = !existsSync(HOOK);

/**
 * The tip of the newest remote-tracking ref — a commit origin demonstrably DOES have.
 *
 * Written first as `rev-list -1 HEAD --remotes=origin`, which is wrong: `--remotes` adds the remote
 * refs as extra STARTING points rather than filtering by them, so what comes back is the newest
 * commit reachable from EITHER side. That agreed with the intent only while the checkout was level
 * with origin, and began returning a local unpushed commit the moment one existed — turning the
 * skip case into a case that must NOT skip. Caught by the very gate this file tests, on the push
 * that carried it.
 *
 * `null` when there are none. A shallow checkout legitimately has no remote-tracking branches, and
 * an empty sha would silently build a malformed ref line instead of skipping — a test that runs
 * against nonsense is worse than one that declares it cannot run.
 */
function pushedShaOrNull(): string | null {
  try {
    return git("rev-list", "-1", "--remotes=origin") || null;
  } catch {
    return null;
  }
}

const pushedSha = pushedShaOrNull();

describe.skipIf(hookMissing || pushedSha === null)(
  "pre-push — the no-new-commits skip (B-113)",
  () => {
    // Non-null by the guard above; named so the cases read as claims about pushes, not optionality.
    const pushed = pushedSha as string;
    // A commit origin demonstrably does not have, created without moving any branch.
    const newSha = git("commit-tree", "HEAD^{tree}", "-p", "HEAD", "-m", "test fixture: unpushed");

    it("test_the_gate_is_skipped_for_a_tag_on_an_already_pushed_commit", () => {
      // The case B-113 was filed for: the release tag push.
      expect(gateRan(`refs/tags/v0.0.0-probe ${pushed} refs/tags/v0.0.0-probe ${ZERO}\n`)).toBe(
        false,
      );
    });

    it("test_the_gate_runs_for_a_branch_carrying_a_new_commit", () => {
      expect(gateRan(`refs/heads/probe ${newSha} refs/heads/probe ${pushed}\n`)).toBe(true);
    });

    it("test_the_gate_runs_for_a_new_tag_on_a_new_commit", () => {
      // A tag is not a licence to skip — only an already-pushed target is. Tagging an unpushed commit
      // would otherwise be the way to smuggle one past the gate.
      expect(gateRan(`refs/tags/v0.0.0-new ${newSha} refs/tags/v0.0.0-new ${ZERO}\n`)).toBe(true);
    });

    it("test_one_new_ref_makes_the_gate_run_for_the_whole_push", () => {
      // `git push --follow-tags` sends several refs at once; the decision is per push, not per ref.
      expect(
        gateRan(
          `refs/tags/v0.0.0-old ${pushed} refs/tags/v0.0.0-old ${ZERO}\n` +
            `refs/heads/probe ${newSha} refs/heads/probe ${pushed}\n`,
        ),
      ).toBe(true);
    });

    it("test_the_gate_runs_when_stdin_says_nothing", () => {
      // Fail-safe. Nothing to classify must mean validate, never skip.
      expect(gateRan("")).toBe(true);
    });
  },
);
