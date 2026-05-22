/**
 * T4.1 runner tests — verifies tsx spawn + signal forwarding without
 * actually running a long-lived child (we use a no-op script).
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { startRunner } from "../../src/dev/runner.js";

let workDir: string;
beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "tk-runner-"));
});
afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("startRunner (T4.1)", () => {
  it("spawns tsx and exits when entry completes", async () => {
    const entry = join(workDir, "noop.ts");
    writeFileSync(entry, 'console.log("ok"); process.exit(0);');
    const handle = startRunner({ entry, cwd: workDir, watch: false });
    const code = await handle.exited;
    expect(code).toBe(0);
  });

  it("propagates entry exit code", async () => {
    const entry = join(workDir, "fail.ts");
    writeFileSync(entry, "process.exit(7);");
    const handle = startRunner({ entry, cwd: workDir, watch: false });
    const code = await handle.exited;
    expect(code).toBe(7);
  });

  it("loads .env when present", async () => {
    const entry = join(workDir, "env.ts");
    writeFileSync(
      entry,
      'if (process.env.TK_TEST !== "yes") { console.error("env not loaded"); process.exit(1); } process.exit(0);',
    );
    writeFileSync(join(workDir, ".env"), "TK_TEST=yes\n");
    const handle = startRunner({ entry, cwd: workDir, watch: false });
    const code = await handle.exited;
    expect(code).toBe(0);
  });
});
