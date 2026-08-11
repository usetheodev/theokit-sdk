/**
 * The containment root reaches `resolveImports` through the real discovery path.
 *
 * `context-import-containment.test.ts` proves the resolver refuses an escaping target when
 * it is GIVEN a root. This proves the runner actually gives it one — the half that decides
 * whether the guard exists in production or only in a unit test.
 *
 * The scenario is the threat itself: a repository is cloned, it carries a `CLAUDE.md`
 * (`followImports: true`, `git-root-walk`), and that file names a path outside the
 * repository. Before the fix the file's content was inlined into the agent's system prompt.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runDiscovery } from "../../../src/internal/runtime/context/context-discovery-runner.js";

let root: string;
let repo: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "theokit-discovery-import-root-"));
  repo = join(root, "cloned-repo");
  // `.git` is what `findGitRoot` looks for — it makes `repo` the git root, and therefore
  // the containment boundary the runner derives.
  mkdirSync(join(repo, ".git"), { recursive: true });
  writeFileSync(join(root, "private.txt"), "SENTINEL-OUTSIDE-THE-REPO", "utf8");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("runDiscovery confines @imports to the repository", () => {
  it("test_a_cloned_repo_cannot_inline_a_file_from_outside_the_repository", async () => {
    writeFileSync(join(repo, "CLAUDE.md"), `# Project\n\n@${join(root, "private.txt")}\n`, "utf8");

    const sources = await runDiscovery({ cwd: repo, maxBytesPerFile: 64_000 });
    const claude = sources.find((s) => s.id.startsWith("CLAUDE.md"));

    expect(claude, "CLAUDE.md was not discovered — the test would pass vacuously").toBeDefined();
    expect(
      claude?.content,
      "a cloned repository read a file from outside itself into the system prompt",
    ).not.toContain("SENTINEL-OUTSIDE-THE-REPO");
    expect(claude?.content).toContain("refused");
  });

  it("test_an_import_inside_the_repository_still_resolves", async () => {
    // Anti-vacuity floor: a runner that refused every import would satisfy the test above.
    writeFileSync(join(repo, "shared.md"), "SENTINEL-INSIDE-THE-REPO", "utf8");
    writeFileSync(join(repo, "CLAUDE.md"), "# Project\n\n@shared.md\n", "utf8");

    const sources = await runDiscovery({ cwd: repo, maxBytesPerFile: 64_000 });
    const claude = sources.find((s) => s.id.startsWith("CLAUDE.md"));

    expect(claude?.content).toContain("SENTINEL-INSIDE-THE-REPO");
  });

  it("test_an_embedder_may_declare_a_narrower_root_than_the_repository", async () => {
    // `importRoot` exists for a host whose trust boundary is tighter than the repo — a
    // workspace package, say. Without it the repository is the boundary, which is the
    // right default but not the only defensible one.
    const pkg = join(repo, "packages", "app");
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(repo, "elsewhere.md"), "SENTINEL-ELSEWHERE-IN-REPO", "utf8");
    writeFileSync(join(pkg, "CLAUDE.md"), "# App\n\n@../../elsewhere.md\n", "utf8");

    const sources = await runDiscovery({
      cwd: pkg,
      maxBytesPerFile: 64_000,
      importRoot: pkg,
    });
    const claude = sources.find((s) => s.id.startsWith("CLAUDE.md"));

    expect(claude?.content).not.toContain("SENTINEL-ELSEWHERE-IN-REPO");
  });
});
