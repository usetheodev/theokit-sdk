/**
 * #565 — a version must not publish with no record anywhere.
 *
 * The check under test separates two things that look identical from the section alone: content
 * that moved (into a prerelease section of the same version, which is what `changeset pre exit`
 * does) and content that never existed. #565 named the naive guard and why it is wrong — it fails
 * every correct pre-exit release — so these tests pin the boundary rather than the absence.
 *
 * Every case builds a throwaway git repository, because the check reads a DIFF: its whole design is
 * that a published section is a record nobody may edit, and only the sections a change ADDS are
 * still in play.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const script = resolve(__dirname, "..", "..", "..", "tools", "check-changelog-section-content.mjs");

let repo: string;

/** The copy inside the fixture — see the note at its first use. */
const fixtureScript = () => join(repo, "tools", "check-changelog-section-content.mjs");

function git(args: string[]): void {
  execFileSync("git", args, { cwd: repo, stdio: "ignore" });
}

function writeChangelog(body: string): void {
  mkdirSync(join(repo, "packages", "foo"), { recursive: true });
  writeFileSync(join(repo, "packages", "foo", "CHANGELOG.md"), body);
}

/** Commit `before`, capture the ref, commit `after`, and run the check across the two. */
function runAcross(before: string, after: string) {
  writeChangelog(before);
  git(["add", "-A"]);
  git(["commit", "-m", "before"]);
  const base = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();

  writeChangelog(after);
  git(["add", "-A"]);
  git(["commit", "-m", "after"]);

  // The COPY inside the fixture, not the original: the script resolves its repository root
  // from its own path, so running the original would ask theokit-sdk about a sha only the
  // fixture has — which is exactly the exit-2 refusal, and it caught this mistake.
  const r = spawnSync("node", [fixtureScript(), base, "HEAD"], { cwd: repo, encoding: "utf8" });
  return { status: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

describe("#565 — an added CHANGELOG section must carry a record", () => {
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "theokit-565-"));
    // The script resolves its repo root from its own path, so it must live inside the fixture.
    mkdirSync(join(repo, "tools"), { recursive: true });
    execFileSync("cp", [script, join(repo, "tools")]);
    git(["init", "-q", "."]);
    git(["config", "user.email", "t@t"]);
    git(["config", "user.name", "t"]);
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("fails when the section is empty and no prerelease of that version carries the entries", () => {
    const { status, out } = runAcross(
      "# Changelog\n\n## 1.0.0\n\nA real entry.\n",
      "# Changelog\n\n## 1.0.1\n\n## 1.0.0\n\nA real entry.\n",
    );

    // The case worth failing: the version publishes and its CHANGELOG says nothing, anywhere.
    expect(status, "a version with no record anywhere must fail the release").toBe(1);
    expect(out).toContain("packages/foo/CHANGELOG.md § 1.0.1");
  });

  it("passes, reporting, when the entries are in a prerelease section of the SAME version", () => {
    const { status, out } = runAcross(
      "# Changelog\n\n## 1.0.0\n\nA real entry.\n",
      "# Changelog\n\n## 1.0.1\n\n## 1.0.1-next.0\n\n### Patch Changes\n\n- Something shipped.\n\n## 1.0.0\n\nA real entry.\n",
    );

    // `changeset pre exit` produces exactly this, and #565 is explicit that failing here would
    // refuse every correct release that exits prerelease mode. The reader is stranded, which is
    // worth saying; nothing is lost, which is why it is not fatal.
    expect(status, "content one section down is a signpost problem, not a lost entry").toBe(0);
    expect(out).toContain("1.0.1-next.0");
    expect(out).toMatch(/Nothing is lost/);
  });

  it("passes silently on a change that adds no section at all", () => {
    const { status, out } = runAcross(
      "# Changelog\n\n## 1.0.0\n\nA real entry.\n",
      "# Changelog\n\n## 1.0.0\n\nA real entry, reworded.\n",
    );

    expect(status).toBe(0);
    // CONTRIBUTING § "A silent gate reports absence it never checked": skipping is a legitimate
    // outcome and reporting it is not optional, so the scope is printed even when there is none.
    expect(out, "a gate that reports nothing on success cannot be audited").toContain(
      "nothing to check",
    );
  });

  it("refuses rather than passes when a ref cannot be resolved", () => {
    writeChangelog("# Changelog\n\n## 1.0.0\n\nA real entry.\n");
    git(["add", "-A"]);
    git(["commit", "-m", "only"]);

    const r = spawnSync("node", [fixtureScript(), "refs/heads/nope", "HEAD"], {
      cwd: repo,
      encoding: "utf8",
    });

    // An empty section list means "nothing to check", so an unreadable ref would otherwise pass as
    // a clean release — the failure mode this repository has paid for in three other guards.
    expect(r.status, "an unresolvable ref must refuse, not report clean").toBe(2);
  });
});
