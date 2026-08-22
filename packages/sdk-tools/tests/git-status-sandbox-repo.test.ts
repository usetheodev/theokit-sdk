import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SandboxProvider } from "@theokit/sdk/sandbox";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createGitStatusTool } from "../src/git-status.js";

/*
 * #346 — `git_status` refused before reaching the sandbox when `<projectRoot>/.git` was missing on
 * the HOST.
 *
 * A session whose repository lives inside the backend (Docker/E2B, or any host whose working
 * directory is not a checkout) got `not_a_repo` for a repository that is perfectly present where
 * the command would have run — while `git_diff`, configured identically in the same session, worked.
 *
 * The answer is also actively misleading rather than merely unavailable. `not_a_repo` exists so the
 * model cannot read "no repository" as "nothing changed"; here it said "no repository" about a
 * repository with changes.
 *
 * `statusViaSandbox` already detected a real non-repo from git's own stderr, exactly as
 * `diffViaSandbox` does. It was simply never reached.
 */

let root: string;

function fakeSandbox(result: { stdout?: string; stderr?: string; exitCode?: number }) {
  const execute = vi.fn(async () => ({
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.exitCode ?? 0,
    timedOut: false,
  }));
  // `resolveSandbox` narrows on `instanceof SandboxBackend`, so a bare object is not a backend —
  // it is handed the ctx and called. A resolver is the documented per-request form and is what a
  // multi-tenant consumer passes, so the test uses it.
  return { backend: (() => ({ execute })) as unknown as SandboxProvider<unknown>, execute };
}

beforeEach(() => {
  // A directory that is deliberately NOT a checkout — the host in a confined session.
  root = mkdtempSync(join(tmpdir(), "git-status-host-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

it("asks the backend, not the host, whether there is a repository", async () => {
  const { backend, execute } = fakeSandbox({ stdout: "## main\n M src/index.ts\n" });
  const tool = createGitStatusTool({ projectRoot: root, sandbox: backend });

  const out = JSON.parse((await tool.handler({}, {})) as string);

  expect(execute).toHaveBeenCalledTimes(1);
  expect(out).toMatchObject({ ok: true });
  expect(out.diff).toContain("M src/index.ts");
});

it("still reports not_a_repo when the BACKEND says so", async () => {
  // The accepted case (`testing.md` § 4.2). Skipping the host probe must not lose the typed error —
  // an empty result would read to the model as "nothing changed", which is the trap the error
  // exists to prevent.
  const { backend } = fakeSandbox({
    exitCode: 128,
    stderr: "fatal: not a git repository (or any of the parent directories): .git",
  });
  const tool = createGitStatusTool({ projectRoot: root, sandbox: backend });

  expect(JSON.parse((await tool.handler({}, {})) as string)).toEqual({
    ok: false,
    error: "not_a_repo",
  });
});

it("keeps refusing on the host when no sandbox is injected", async () => {
  // The other accepted case: without a backend the command DOES run on the host, so the local probe
  // is the right answer there and must stay.
  const tool = createGitStatusTool({ projectRoot: root });

  expect(JSON.parse((await tool.handler({}, {})) as string)).toEqual({
    ok: false,
    error: "not_a_repo",
  });
});

it("still refuses a path that escapes the project root, sandbox or not", async () => {
  const { backend, execute } = fakeSandbox({ stdout: "" });
  const tool = createGitStatusTool({ projectRoot: root, sandbox: backend });

  const out = JSON.parse((await tool.handler({ path: "../../etc" }, {})) as string);

  expect(out).toMatchObject({ ok: false, error: "path_traversal" });
  expect(
    execute,
    "the scope check is security, and it runs before the backend",
  ).not.toHaveBeenCalled();
});
