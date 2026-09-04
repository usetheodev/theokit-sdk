import { homedir } from "node:os";
import { join, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { defaultIndexPath } from "../../src/internal/memory/index-db.js";
import {
  memoryIndexRoot,
  projectMemoryDir,
  resolveMemoryRoot,
} from "../../src/internal/memory/storage/memory-root.js";

/*
 * Where the index lives when `memory.directory` moves the store (theokit-sdk#554).
 *
 * The index is not a pointer: its `chunks.text` column holds the fact TEXT, because FTS5/BM25
 * needs it to search. So a copy of the index is a copy of the memory. Leaving it in `<cwd>` while
 * the facts move means an operator who points `directory` at one personal store gets that store's
 * contents written into every repository the agent runs in — untracked, un-ignored, and readable
 * with `strings`.
 *
 * `docs/memory-decisions.md` § 1 says the index stays in the project store on purpose, and that
 * decision is correct FOR THE CASE IT NAMES: `directory` pointing at the Claude Code CLI's own
 * directory, which has no index format, so writing a binary there puts an artefact the CLI does
 * not understand inside a directory it manages.
 *
 * That reason does not reach any other directory. These tests pin both halves, so the decision
 * keeps its scope instead of being widened into a leak or reverted into a partner-breaking write.
 */
describe("the index follows a relocated store (#554)", () => {
  it("a plain directory takes its own index", () => {
    const cwd = join(sep, "tmp", "some-project");
    const store = join(sep, "tmp", "my-shared-memory");

    // The whole store moves, index included — one store, one index.
    expect(memoryIndexRoot(cwd, resolveMemoryRoot(cwd, { directory: store }))).toBe(store);
    expect(
      defaultIndexPath(memoryIndexRoot(cwd, resolveMemoryRoot(cwd, { directory: store }))),
    ).toBe(join(store, ".index", "memory.sqlite"));
  });

  it("the Claude Code directory does NOT, which is decision § 1 intact", () => {
    // The CLI's layout, decidable from the path alone.
    const cwd = join(sep, "tmp", "some-project");
    const cliStore = join(homedir(), ".claude", "projects", "-tmp-some-project", "memory");

    // The facts go to the CLI. The index stays here, because the CLI has no index format.
    expect(memoryIndexRoot(cwd, resolveMemoryRoot(cwd, { directory: cliStore }))).toBe(
      projectMemoryDir(cwd),
    );
  });

  it("no directory at all is unchanged — the project store IS the store", () => {
    const cwd = join(sep, "tmp", "some-project");
    expect(memoryIndexRoot(cwd, resolveMemoryRoot(cwd, undefined))).toBe(projectMemoryDir(cwd));
    expect(memoryIndexRoot(cwd, resolveMemoryRoot(cwd, {}))).toBe(projectMemoryDir(cwd));
  });
});
