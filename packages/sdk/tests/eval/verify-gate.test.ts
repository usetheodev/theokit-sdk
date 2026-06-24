/**
 * M6-2 — `Scorers.verifyGate`: grade a patch by test-command exit code.
 *
 * Drives the real `LocalSandbox` (no mocks): a command that exits 0 scores 1,
 * a command that exits non-zero scores 0 with the exit code in the reason.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalSandbox } from "../../src/sandbox/local-sandbox.js";
import { Scorers } from "../../src/scorers.js";

describe("Scorers.verifyGate (M6-2)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "theo-verify-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("test_verifyGate_defaults_to_local_sandbox", async () => {
    // V3-5 (b): sandbox is optional; verifyGate defaults to a LocalSandbox. It is
    // workdir-independent (always `cd`s to the explicit repoDir), so no isolation
    // needed (EC-3).
    const scorer = Scorers.verifyGate({
      repoDir: dir,
      failToPass: ["t1"],
      passToPass: [],
      command: () => "true",
    });
    const result = await scorer.score("", undefined);
    expect(result.score).toBe(1);
  });

  it("test_verifyGate_explicit_sandbox_unchanged", async () => {
    // Regression: an explicit sandbox is still honored.
    const sandbox = new LocalSandbox({ workDir: dir });
    const scorer = Scorers.verifyGate({
      sandbox,
      repoDir: dir,
      failToPass: ["t1"],
      passToPass: [],
      command: () => "false",
    });
    const result = await scorer.score("", undefined);
    expect(result.score).toBe(0);
  });

  it("scores 1 when the test command exits zero", async () => {
    const sandbox = new LocalSandbox({ workDir: dir });
    const scorer = Scorers.verifyGate({
      sandbox,
      repoDir: dir,
      failToPass: ["t1"],
      passToPass: [],
      command: () => "true",
    });
    const result = await scorer.score("", undefined);
    expect(result.score).toBe(1);
  });

  it("scores 0 with the exit code in the reason when the command exits non-zero", async () => {
    const sandbox = new LocalSandbox({ workDir: dir });
    const scorer = Scorers.verifyGate({
      sandbox,
      repoDir: dir,
      failToPass: ["t1"],
      passToPass: ["t2"],
      command: () => "false",
    });
    const result = await scorer.score("", undefined);
    expect(result.score).toBe(0);
    expect(result.reason).toContain("exit=1");
  });

  it("scores 0 when the command builder yields an empty command", async () => {
    const sandbox = new LocalSandbox({ workDir: dir });
    const scorer = Scorers.verifyGate({
      sandbox,
      repoDir: dir,
      failToPass: [],
      passToPass: [],
      command: () => "",
    });
    const result = await scorer.score("", undefined);
    expect(result.score).toBe(0);
    expect(result.reason).toContain("empty_command");
  });
});
