import { mkdtempSync, rmSync } from "node:fs";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, type MockInstance, vi } from "vitest";

export interface TempWorkspace {
  cwd: string;
  writeText(relativePath: string, contents: string): Promise<void>;
  cleanup(): Promise<void>;
}

/**
 * B-082 — the retry policy below used to live ONLY inside `createTempWorkspace().cleanup()`,
 * exercised by the 22 `tests/contract/**` files that went through it. A sweep on 2026-08-19
 * found 51+ additional files across `tests/**` calling `mkdtemp`/`mkdtempSync` directly and
 * never removing the directory at all — not racing this same ENOTEMPTY class, just leaking.
 *
 * Rather than have each of those files invent (or omit) its own teardown, they call this pair
 * of exported helpers via `onTestFinished`. One implementation, so the retry policy — and any
 * future fix to it — changes in exactly one place instead of N one-off `rm(dir, {...})` calls.
 */
export async function removeTempDirRobust(path: string): Promise<void> {
  // See the comment on `cleanup()` below for why `maxRetries` is load-bearing, not padding.
  await rm(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}

export function removeTempDirRobustSync(path: string): void {
  rmSync(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}

export async function createTempWorkspace(fixtureName?: string): Promise<TempWorkspace> {
  const cwd = await mkdtemp(join(tmpdir(), "theokit-sdk-contract-"));

  if (fixtureName) {
    const fixturePath = resolve(import.meta.dirname, "..", "fixtures", "repos", fixtureName);
    await cp(fixturePath, cwd, { recursive: true });
  }

  return {
    cwd,
    async writeText(relativePath, contents) {
      const target = join(cwd, relativePath);
      await mkdir(resolve(target, ".."), { recursive: true });
      await writeFile(target, contents, "utf8");
    },
    async cleanup() {
      // `maxRetries` is not defensive padding — without it this line is the single
      // largest source of flakiness in the contract suite.
      //
      // The SDK persists session summaries and the agent registry with fire-and-forget
      // writes that outlive the call the test awaited (they announce themselves in the
      // run log as `session summary write failed … ENOENT … registry.json.<pid>.tmp ->
      // registry.json`). When teardown runs while one of those writes is landing, `rm`
      // reads the directory, the writer creates a file, and `rmdir` fails with
      // `ENOTEMPTY: directory not empty, rmdir '<tmp>/.theokit/agents'` — reported as a
      // failure of whichever test happened to finish first.
      //
      // Measured 2026-08-19: `tests/contract/{agent-create,artifacts}` failed this way in
      // an isolated 27-file run and PASSED in the next run of the same files; and
      // `tests/contract/run-conversation` passed in isolation and failed inside the full
      // 683-file suite, on `<tmp>/.theokit/memory/sessions`. Twenty-two contract files
      // share this helper, so any of them can be the one that fails on a given run.
      //
      // Node retries exactly this error class (EBUSY, EMFILE, ENFILE, ENOTEMPTY, EPERM)
      // with a linear backoff when `maxRetries` is set. Ten tries at 50 ms give the
      // in-flight write up to ~2.75s to land, which is far beyond the observed window and
      // still far below the 20s hook timeout. Nothing is hidden: the SDK's own warning
      // about the late write is still printed, because that is a separate finding.
      await removeTempDirRobust(cwd);
    },
  };
}

/**
 * Make this test file's `process.cwd()` report a throwaway directory.
 *
 * `Agent.create` and `Agent.getOrCreate` resolve their workspace to `process.cwd()` when given
 * neither `local` nor `cloud`, and during a vitest run that is `packages/sdk` itself — so a test
 * that creates an agent without saying where persists real session state into the repository.
 * Measured 2026-09-01: 22,671 agent directories, 82,684 session files and 1,984 orphaned
 * atomic-write temps, 540 MB, spanning the whole life of the checkout. `.gitignore` excludes
 * `.theokit/`, so none of it ever appeared in `git status`, in a diff, or in CI.
 *
 * `THEOKIT_HOME` does not help: the per-project store is `join(cwd, ".theokit")` and
 * `internal/persistence/paths.ts` says the two defaults differ on purpose.
 *
 * SPIES ON `process.cwd` RATHER THAN CALLING `process.chdir`. The first version of this helper used
 * the real syscall and `tests/lint/no-process-chdir.test.ts` failed it immediately — correctly.
 * B-093 records why that gate exists: `chdir` is process-wide and THROWS under vitest's `threads`
 * pool ("not supported in workers"), while the default `forks` pool happens to allow it, so the
 * breakage would not surface until something ran the suite under a different pool — Stryker's
 * mutation dry run, for instance. Three files had reached for it independently before the gate was
 * written; this would have been the fourth. The spy is what `withMockedCwd` already does for a
 * single call; this is the file-scoped form.
 *
 * Call it at file scope, outside any `describe`. `vitest.global-setup.ts` fails the run if a file
 * that needed it forgot.
 */
export function useTempCwd(prefix = "theokit-test-cwd-"): void {
  let dir: string | undefined;
  let spy: MockInstance<typeof process.cwd> | undefined;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), prefix));
    spy = vi.spyOn(process, "cwd").mockReturnValue(dir);
  });
  afterAll(() => {
    spy?.mockRestore();
    if (dir !== undefined) removeTempDirRobustSync(dir);
  });
}
