import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  claudeProjectMemoryDir,
  memoryReadRoots,
} from "../src/internal/memory/storage/memory-root.js";
import { encodeProjectDir } from "../src/internal/persistence/session-transcript.js";

/*
 * #479 — the interop read looked in a directory the CLI never writes to.
 *
 * `claudeProjectMemoryDir` keyed the Claude Code auto-memory store by `cwd`. The CLI keys it by the
 * GIT REPOSITORY ROOT: "the <project> path is derived from the git repository, so all worktrees and
 * subdirectories within the same repo share one auto memory directory. Outside a git repo, the
 * project root is used instead."
 *
 * So an agent running from any directory below the root — a monorepo package, a script in `tools/`,
 * a test in a subfolder, which is the ordinary case — read an empty directory and said nothing. The
 * observation is identical to an empty store, which is why it survived the whole interop change.
 *
 * Confirmed on this machine before the fix: of the project directories that resolve to a
 * SUBDIRECTORY of a git repository, none had a `memory/` at all, while their repo root had three
 * fact files. The subdirectory dirs held only session transcripts.
 *
 * TRANSCRIPTS ARE THE TRAP: the CLI keys THOSE by `cwd`, correctly, and `encodeProjectDir` is right
 * for them. Reusing one encoder for both axes is what made the two indistinguishable in the code,
 * so the case below pins that they now disagree where the CLI disagrees.
 */
describe("the Claude Code interop memory root", () => {
  let repo: string;
  let nested: string;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "gitroot-"));
    mkdirSync(join(repo, ".git"), { recursive: true });
    nested = join(repo, "packages", "deep");
    mkdirSync(nested, { recursive: true });
    process.env.CLAUDE_CONFIG_DIR = mkdtempSync(join(tmpdir(), "cchome-"));
  });
  afterEach(() => {
    process.env.CLAUDE_CONFIG_DIR = undefined;
  });

  it("test_a_subdirectory_resolves_to_the_repository_root", () => {
    expect(claudeProjectMemoryDir(nested)).toBe(claudeProjectMemoryDir(repo));
  });

  it("test_the_root_itself_is_unchanged", () => {
    const home = process.env.CLAUDE_CONFIG_DIR as string;
    expect(claudeProjectMemoryDir(repo)).toBe(
      join(home, "projects", encodeProjectDir(repo), "memory"),
    );
  });

  /*
   * The CLI's documented fallback, and the accepted input for the case above: outside a repository
   * there is no root to derive, so `cwd` is the key. Without this, resolving to `/` or to the
   * nearest ancestor with a `.git` somewhere else would pass the first case and be wrong here.
   */
  it("test_outside_a_repository_the_cwd_is_still_the_key", () => {
    const loose = mkdtempSync(join(tmpdir(), "norepo-"));
    const home = process.env.CLAUDE_CONFIG_DIR as string;
    expect(claudeProjectMemoryDir(loose)).toBe(
      join(home, "projects", encodeProjectDir(loose), "memory"),
    );
  });

  // A worktree and a submodule carry a `.git` FILE, not a directory. Both are inside a repository
  // and must resolve, or the read silently misses again in exactly the layout that motivated this.
  it("test_a_dot_git_file_counts_as_a_repository", () => {
    const wt = mkdtempSync(join(tmpdir(), "worktree-"));
    writeFileSync(join(wt, ".git"), "gitdir: /somewhere/.git/worktrees/wt\n");
    const inner = join(wt, "pkg");
    mkdirSync(inner, { recursive: true });
    expect(claudeProjectMemoryDir(inner)).toBe(claudeProjectMemoryDir(wt));
  });

  /*
   * Transcripts stay keyed by `cwd`, because that is what the CLI does with them. This is the case
   * that would fail if someone "unified" the two encoders later — the conflation that caused #479.
   */
  it("test_the_transcript_key_still_follows_the_cwd", () => {
    expect(encodeProjectDir(nested)).not.toBe(encodeProjectDir(repo));
  });

  it("test_the_read_roots_carry_the_repository_scoped_directory", () => {
    expect(memoryReadRoots(nested)).toContain(claudeProjectMemoryDir(repo));
  });
});
