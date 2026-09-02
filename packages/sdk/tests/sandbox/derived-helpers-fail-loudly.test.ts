/**
 * A backend whose `execute` is not a POSIX shell gets an ERROR, not an empty array.
 *
 * `SandboxBackend` derives `readFile`, `glob`, `grep` and `listDir` from `execute` by shelling out
 * `cat`, `find`, `grep` and `ls`. Its docblock says so and warns that "a backend whose `execute` is
 * not a POSIX shell must override them as well" — an honest note, and not an enforceable contract.
 * The failure mode for missing it was `return []`: a search that could not run reported the same
 * thing as a search that found nothing, and those are opposite facts. One is normal; the other means
 * the agent is looking at a filesystem it cannot read.
 *
 * `readFile` already threw. These three now do too, and the distinction they draw is the one the
 * tools actually make: `grep` exits 1 for NO MATCH and ≥2 for an error, `find` exits 0 with empty
 * output when nothing matched. A no-match still returns `[]`, because that is a real answer.
 *
 * WHAT THIS DOES NOT DO, stated because the audit offers it and it is a real cost: it does not make a
 * non-POSIX backend fail to COMPILE. Both shapes for that — a new abstract `shellExecute`, or making
 * these four abstract like `FilesystemBackend` does — are breaking changes on a published class, and
 * they force the two POSIX backends that exist to implement four methods they correctly inherit. A
 * loud runtime failure is the part that is worth its cost today.
 */
import { describe, expect, it } from "vitest";

import type { ExecuteResult } from "../../src/sandbox/types.js";
import { SandboxBackend } from "../../src/sandbox/types.js";

/** A backend whose `execute` is not a shell at all — the case the docblock warns about. */
class NotAShell extends SandboxBackend {
  execute(): Promise<ExecuteResult> {
    return Promise.resolve({ stdout: "", stderr: "sh: not found", exitCode: 127, timedOut: false });
  }
  uploadFile(): Promise<void> {
    return Promise.resolve();
  }
}

/** A real POSIX shell that simply found nothing — the answer that must stay `[]`. */
class FoundNothing extends SandboxBackend {
  execute(): Promise<ExecuteResult> {
    return Promise.resolve({ stdout: "", stderr: "", exitCode: 1, timedOut: false });
  }
  uploadFile(): Promise<void> {
    return Promise.resolve();
  }
}

describe("SandboxBackend derived helpers", () => {
  it("glob throws when the command could not run", async () => {
    await expect(new NotAShell().glob("*.ts")).rejects.toThrow(/glob/i);
  });

  it("grep throws when the command could not run", async () => {
    await expect(new NotAShell().grep("needle")).rejects.toThrow(/grep/i);
  });

  it("listDir throws when the command could not run", async () => {
    await expect(new NotAShell().listDir("/x")).rejects.toThrow(/listDir/i);
  });

  it("grep still returns [] for a genuine no-match", async () => {
    // grep exits 1 with empty stderr when the pattern is absent. That is an ANSWER, and turning it
    // into an error would be the opposite mistake to the one being fixed.
    await expect(new FoundNothing().grep("needle")).resolves.toEqual([]);
  });

  it("glob still returns [] when find matched nothing", async () => {
    // `find` exits 0 with empty output. Nothing to distinguish and nothing to throw about.
    class NoMatches extends SandboxBackend {
      execute(): Promise<ExecuteResult> {
        return Promise.resolve({ stdout: "", stderr: "", exitCode: 0, timedOut: false });
      }
      uploadFile(): Promise<void> {
        return Promise.resolve();
      }
    }
    await expect(new NoMatches().glob("*.nope")).resolves.toEqual([]);
  });
});
