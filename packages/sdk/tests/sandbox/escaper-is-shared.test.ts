/**
 * The command-injection barrier must have ONE definition.
 *
 * `src/sandbox/` held two independent POSIX single-quote escapers: the exported
 * `shellEscapePosix`, whose docstring states the stakes — *"execute runs via
 * /bin/sh -c, so any untrusted value MUST be quoted to prevent command injection"* —
 * and a private `shellQuote` inside `linux-sandbox.ts` with the same contract in its
 * own words. They were behaviourally identical, so this was never a live hole; it was
 * the shape, and the shape matters more here than almost anywhere else because of what
 * the private copy guarded: the bwrap argv, and the `uploadFile` command that
 * interpolates a base64 payload and a target path into the confined shell — which the
 * surrounding comment identifies as *"exactly where a 'confined' write would turn into
 * command injection."*
 *
 * The failure mode was never "the copies disagree today". It was that a hardening
 * applied to the exported escaper — a new metacharacter case, a NUL guard, a length
 * bound — would reach `provision.ts`, `types.ts`, `scorers.ts` and `eval/code-runner.ts`
 * and silently miss the sandbox's own wrap. This package has already paid for that
 * pattern once and wrote it down: `path-containment.ts` exists because the package
 * *"held it twice, at different strengths, for the same question"*.
 *
 * So this file does not compare two escapers — there is only one now. It asserts the
 * wrap is BUILT FROM it, which is what makes a future private re-implementation fail
 * instead of passing quietly: harden `shellEscapePosix` and these expectations move
 * with it; re-introduce a private copy and they stop matching.
 *
 * The payloads below are deliberately inert. Proving a quoter works needs a string that
 * WOULD break out if unquoted, not one that does damage if it does — a destructive
 * fixture buys no coverage and makes the file hazardous to run.
 */
import { describe, expect, it } from "vitest";

import { wrapCommandForSandbox } from "../../src/sandbox/linux-sandbox.js";
import { shellEscapePosix } from "../../src/sandbox/shell-escape.js";

/** Values chosen because each breaks a naive quoter in a different way. */
const HOSTILE = [
  "echo hi'; echo INJECTED; echo '",
  "$(whoami)",
  "`id`",
  'a"b',
  "a\\b",
  "back' to 'back",
] as const;

describe("the sandbox wrap is built from the shared escaper", () => {
  it.each(HOSTILE)("a command containing %j is quoted by shellEscapePosix", (hostile) => {
    const wrapped = wrapCommandForSandbox("workspace-write", { cwd: "/tmp/x", env: {} }, hostile);
    expect(wrapped, "the workspace-write policy must produce a wrap").not.toBeNull();
    expect(
      String(wrapped),
      "the wrapped command must contain the payload exactly as the SHARED escaper renders it. " +
        "If this fails after a change to shellEscapePosix, the sandbox has grown a private copy again.",
    ).toContain(shellEscapePosix(hostile));
  });

  it("the cwd is quoted by the same escaper, not by an ad-hoc quoter", () => {
    const nasty = "/tmp/dir with spaces/and'quote";
    const wrapped = wrapCommandForSandbox("workspace-write", { cwd: nasty, env: {} }, "true");
    expect(wrapped).not.toBeNull();
    expect(String(wrapped)).toContain(shellEscapePosix(nasty));
  });

  it("shellEscapePosix escapes an embedded single quote", () => {
    // The behavioural checks above are measured AGAINST this contract, so without it
    // they would agree with a broken escaper as happily as a correct one.
    expect(shellEscapePosix("it's")).toBe("'it'\\''s'");
  });

  it("src/sandbox defines exactly one POSIX escaper, and it is the exported one", async () => {
    // WHY THIS IS STRUCTURAL AND NOT BEHAVIOURAL. The checks above can only catch a
    // private copy that DIVERGES on the six fixtures they happen to use. Measured while
    // writing this file: re-introducing a byte-identical private copy and then adding a
    // NUL guard to the shared escaper — the exact hardening-misses-the-copy scenario the
    // finding describes — left all eight behavioural cases green, because no fixture
    // contains a NUL byte. A behavioural test cannot see a divergence its inputs do not
    // reach, and the copy the folder actually held was byte-identical, so no behavioural
    // test could ever have failed on it. Counting the definitions is the only check that
    // fires on the state that existed.
    const dir = new URL("../../src/sandbox/", import.meta.url);
    const { readdir, readFile } = await import("node:fs/promises");
    const names = (await readdir(dir)).filter((n) => n.endsWith(".ts"));

    // ANTI-VACUITY GUARD. A scan that finds nothing passes every assertion below, which
    // is how a check quietly stops checking. The sentinel is the file the barrier is
    // supposed to live in: if it is not in the scan, the scan is wrong, not the code.
    expect(names, "the scan of src/sandbox/ must reach shell-escape.ts").toContain(
      "shell-escape.ts",
    );

    // A POSIX single-quote escaper is recognisable by what it must do: replace `'` with
    // the `'\''` sequence. Any spelling of that — replace, replaceAll, split/join — is a
    // definition of the barrier.
    const ESCAPER = /replace(All)?\(\s*(\/'\/g|"'"|'\u0027')/;
    const definers: string[] = [];
    for (const name of names) {
      const src = await readFile(new URL(name, dir), "utf8");
      if (ESCAPER.test(src)) definers.push(name);
    }

    expect(
      definers,
      "The command-injection barrier must have one definition. A second file in src/sandbox/ " +
        "escaping single quotes is a private re-implementation — the state this folder was in, " +
        "where a hardening applied to shell-escape.ts would have silently missed the sandbox wrap.",
    ).toEqual(["shell-escape.ts"]);
  });
});
