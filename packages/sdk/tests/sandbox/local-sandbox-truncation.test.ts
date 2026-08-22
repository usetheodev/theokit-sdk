import { expect, it } from "vitest";
import { LocalSandbox } from "../../src/sandbox/local-sandbox.js";

/**
 * #363 — output past `maxOutputBytes` came back cut with NO marker.
 *
 * `ExecuteResult`'s contract says stdout and stderr "are truncated independently at
 * `SandboxConfig.maxOutputBytes`, with a trailing `...(truncated)` marker. Neither is safe to parse
 * as a complete document without checking for it." Checking for it was exactly what did not work:
 * Node caps `execFile`'s buffer AT `maxBuffer`, so for ASCII output the string is exactly `max`
 * bytes — never *greater* — and `truncateOutput`'s `> max` test never fired. The caller saw
 * `exitCode: 1` with a silently shortened document, indistinguishable from a command that failed.
 *
 * Every derived helper (`readFile`, `glob`, `grep`, `listDir`) is built on `execute`, so a
 * `readFile` of a large file returned a prefix presented as the whole file.
 */

it("marks stdout that was cut at maxOutputBytes", async () => {
  const sandbox = new LocalSandbox({ maxOutputBytes: 1000 });

  const result = await sandbox.execute("yes | head -c 100000");

  expect(result.stdout).toContain("...(truncated)");
  expect(result.timedOut).toBe(false);
});

it("marks stderr that was cut at maxOutputBytes", async () => {
  const sandbox = new LocalSandbox({ maxOutputBytes: 1000 });

  const result = await sandbox.execute("yes | head -c 100000 1>&2");

  expect(result.stderr).toContain("...(truncated)");
});

it("leaves output that fits completely unmarked", async () => {
  // The accepted case (`testing.md` § 4.2). A `truncateOutput` that stamped the marker on
  // everything would satisfy both tests above while making the marker meaningless — which is the
  // whole point of a marker a caller is told to branch on.
  const sandbox = new LocalSandbox({ maxOutputBytes: 1000 });

  const result = await sandbox.execute("printf 'small output'");

  expect(result.stdout).toBe("small output");
  expect(result.stdout).not.toContain("truncated");
  expect(result.exitCode).toBe(0);
});

it("leaves output that is exactly maxOutputBytes unmarked", async () => {
  // The boundary. `>= max` would be the tempting one-character fix and it is wrong: a document
  // that happens to be exactly the cap is COMPLETE, and reporting it truncated is a lie in the
  // other direction. The signal has to come from the child being killed, not from a length.
  const sandbox = new LocalSandbox({ maxOutputBytes: 64 });

  const result = await sandbox.execute("printf 'x%.0s' $(seq 1 64)");

  expect(result.stdout).toHaveLength(64);
  expect(result.stdout).not.toContain("truncated");
  expect(result.exitCode).toBe(0);
});
