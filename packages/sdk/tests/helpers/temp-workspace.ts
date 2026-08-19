import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export interface TempWorkspace {
  cwd: string;
  writeText(relativePath: string, contents: string): Promise<void>;
  cleanup(): Promise<void>;
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
      await rm(cwd, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    },
  };
}
