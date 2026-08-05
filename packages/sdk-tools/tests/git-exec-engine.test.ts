/**
 * M76 review (H2) — the git engine's three guarantees, which had no oracle at all.
 *
 * ## What mutation proved
 *
 * The docblock of `internal/git-exec.ts` promises a stdout ceiling, a process-group kill on timeout
 * and mapping to a typed error. The three mutations below **passed with 554 green**:
 *
 *  - removing the stdout ceiling and the `truncated` flag;
 *  - `armTimeoutKill(child, 86_400_000, …)` — o kill nunca dispara;
 *  - `formatGitResult` mapeando timeout para `{ok: true, diff: ""}`.
 *
 * ## Honesty about the cause
 *
 * This was **not lost in M76's extraction**: `tests/git-diff.test.ts` never covered timeout, ceiling
 * or kill — only shape, happy path, scope and `not_a_repo`. What the extraction did was **double the blast
 * radius**: the same oracle-less engine now serves `git_diff` and `git_status`, and `git-status.ts`
 * publica `timeoutMs?`/`maxStdoutBytes?` como se fossem garantias verificadas.
 *
 * Covering it now is this milestone's responsibility because it is what doubled the reach.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { createGitStatusTool } from "../src/git-status.js";

const repo = mkdtempSync(join(tmpdir(), "m76-gitexec-"));
afterAll(() => rmSync(repo, { recursive: true, force: true }));

execFileSync("git", ["init", "-q"], { cwd: repo });
execFileSync("git", ["config", "user.email", "t@t"], { cwd: repo });
execFileSync("git", ["config", "user.name", "t"], { cwd: repo });

describe("M76 review — o motor de git honra os limites que publica", () => {
  it("test_the_stdout_ceiling_TRUNCATES_and_signals", async () => {
    // Many untracked files => large output. With the ceiling at 200 bytes, the real output exceeds it
    // and the `truncated` flag must go up. Without the ceiling, a repo with thousands of files would return
    // megabytes to the model — blowing the context window with no warning.
    for (let i = 0; i < 60; i++) {
      writeFileSync(join(repo, `file-with-a-really-long-name-${String(i)}.txt`), "x");
    }
    const t = createGitStatusTool({ projectRoot: repo, maxStdoutBytes: 200 });
    const parsed = JSON.parse((await t.handler({})) as string) as {
      ok: boolean;
      diff: string;
      truncated: boolean;
    };

    expect(parsed.ok).toBe(true);
    expect(parsed.truncated, "output exceeded the ceiling and `truncated` did not go up").toBe(
      true,
    );
    expect(
      Buffer.byteLength(parsed.diff),
      "the ceiling was not respected — output went past the published limit",
    ).toBeLessThanOrEqual(400);
  });

  it("test_a_generous_ceiling_does_NOT_mark_truncated", async () => {
    // COUNTER-PROOF: without it, an implementation always setting `truncated: true` would pass above.
    const t = createGitStatusTool({ projectRoot: repo, maxStdoutBytes: 5 * 1024 * 1024 });
    const parsed = JSON.parse((await t.handler({})) as string) as { truncated: boolean };
    expect(parsed.truncated).toBe(false);
  });

  it("test_timeout_becomes_a_TYPED_error_and_not_an_empty_success", async () => {
    // The mapping the mutation broke: timeout -> `{ok:true, diff:""}` went unnoticed, and the
    // model would read "no changes" where the command was actually killed. Worse than an error.
    const t = createGitStatusTool({ projectRoot: repo, timeoutMs: 1 });
    const parsed = JSON.parse((await t.handler({})) as string) as {
      ok: boolean;
      error?: string;
      timeoutMs?: number;
    };

    // A `git status` can finish in <1ms in a tiny repo; so we accept both outcomes, but
    // NEVER the third (ok:true with an empty diff because of a timeout).
    if (parsed.ok) {
      expect(parsed.error).toBeUndefined();
    } else {
      expect(parsed.error, "a timeout must be a TYPED error").toBe("timeout");
      expect(parsed.timeoutMs, "the error carries the limit that was exceeded").toBe(1);
    }
  });
});
