/**
 * Lint test — bans a LIVE `process.chdir(` call anywhere under `tests/`.
 *
 * B-093: three files independently reached for `process.chdir()` to isolate a per-test
 * tmpdir (`agent-registry-persistence.golden.test.ts`, `compact-registry-hydration.test.ts`,
 * and an earlier instance in `project-env-sovereign.test.ts` already fixed). It is a
 * process-wide OS syscall — under vitest's `threads` pool it throws `TypeError:
 * process.chdir() is not supported in workers`. The default gate runs under `pool: forks`
 * (`vitest.config.ts`), where chdir happens to work, so nothing in the default `pnpm test`
 * run ever caught this: the failure only surfaces under a different pool (e.g. Stryker's
 * mutation dry run), which is exactly how this reached a third instance unnoticed.
 *
 * The fix, applied consistently across all three: `tests/helpers/with-cwd.ts`'s
 * `withMockedCwd(dir, fn)` spies on `process.cwd` instead of calling the real syscall —
 * every in-process reader observes `dir` for the duration of `fn`, with no worker-pool
 * incompatibility.
 *
 * This gate is a population-level guard, not a point fix: it fails on any FUTURE live
 * `process.chdir(` call anywhere under `tests/`, so a fourth instance cannot land
 * unnoticed the way the first three did. Comments that merely MENTION `process.chdir(`
 * (documenting why it was removed, as this file's own header and several fixed test
 * files do) are not offenders — only an actual call is.
 *
 * @internal
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const TESTS_ROOT = join(__dirname, "..");

interface Offender {
  file: string;
  line: number;
  text: string;
}

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  const entries = await readdir(dir);
  for (const name of entries) {
    const full = join(dir, name);
    const s = await stat(full);
    if (s.isDirectory()) await walk(full, out);
    else if (full.endsWith(".ts") && !full.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

// A live call: `process.chdir(` NOT preceded (on the same line, ignoring leading
// whitespace) by a comment token. This intentionally does not try to parse block
// comments spanning multiple lines — every offender found by B-093 was a single-line
// call, and a scanner that tried to track multi-line comment state would be more
// machinery than the defect it guards against warrants (parsimony ladder rung 5/6).
const LIVE_CALL = /process\.chdir\(/;
const COMMENT_PREFIX = /^\s*(\/\/|\*|\/\*)/;
const SELF = join(TESTS_ROOT, "lint", "no-process-chdir.test.ts");

async function scanFile(file: string): Promise<Offender[]> {
  if (file === SELF) return [];
  const rel = relative(TESTS_ROOT, file);
  const text = await readFile(file, "utf8");
  const offenders: Offender[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line !== undefined && LIVE_CALL.test(line) && !COMMENT_PREFIX.test(line)) {
      offenders.push({ file: rel, line: i + 1, text: line.trim() });
    }
  }
  return offenders;
}

describe("no live process.chdir() under tests/ (B-093)", () => {
  it("packages/sdk/tests/ has no live process.chdir() call", async () => {
    const files = await walk(TESTS_ROOT);
    const offenders: Offender[] = [];
    for (const file of files) {
      offenders.push(...(await scanFile(file)));
    }
    expect(offenders).toEqual([]);
  });
});
