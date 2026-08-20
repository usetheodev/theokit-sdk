/**
 * B-120 — the shared vitest setup isolates `THEOKIT_HOME` per test but used to
 * back `HOME` up and never actually set it (see vitest.setup.ts:70-77, pre-fix).
 * Any module that reads `process.env.HOME` / `os.homedir()` directly instead of
 * consulting `THEOKIT_HOME` resolved to the developer's REAL `~`. Measured
 * 2026-08-19: `~/.theokit/mcp-tokens.json` held 6 fixture keys and its mtime
 * advanced twice during one afternoon of test runs. B-090 fixed the one module
 * that exploited the gap (the MCP token store); this pins the gap itself so the
 * NEXT home-anchored module — present or future — cannot repeat it silently.
 *
 * The isolation must be enforced by the shared setup, not by per-test-file
 * discipline: this file does nothing beyond importing `node:os` — no local
 * `beforeEach`/`afterEach` HOME dance — precisely so the assertions below can
 * only pass if `vitest.setup.ts` itself redirects HOME.
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SANDBOX_PREFIX = join(tmpdir(), "theokit-test-");

describe("vitest setup — HOME isolation (B-120)", () => {
  it("redirects process.env.HOME to an isolated sandbox for the duration of the test", () => {
    const home = process.env.HOME;
    expect(home).toBeDefined();
    // The setup mints the sandbox with `mkdtempSync(join(tmpdir(), "theokit-test-"))`
    // for THEOKIT_HOME; B-120 reuses that SAME directory for HOME. Asserting the
    // prefix (rather than just "is under tmpdir()") pins it to that exact sandbox,
    // not merely to "some tmp path a test set by hand" — the real home directory
    // (`/home/<user>` or `/root`) can never match this pattern.
    expect(home).toContain(SANDBOX_PREFIX);
    // THEOKIT_HOME and HOME must be the SAME sandbox root (one temp dir per test,
    // not two) — the design decision recorded in vitest.setup.ts.
    expect(home).toBe(process.env.THEOKIT_HOME);
  });

  it("makes os.homedir() — the native, ambient resolver — resolve inside the sandbox too", () => {
    // `homedir()` is a native call that re-reads `process.env.HOME` (POSIX) at
    // call time, per node's documented behavior (see token-storage.ts's own
    // comment on this). A module that calls `homedir()` directly, without ever
    // consulting THEOKIT_HOME, is exactly the "next home-anchored module" this
    // item defends against — and it must land in the sandbox, never in the
    // developer's real home.
    const resolved = homedir();
    expect(resolved).toBe(process.env.HOME);
    expect(resolved).toContain(SANDBOX_PREFIX);
  });

  it("a homedir()-anchored write lands inside the sandbox, provably not in the real home", () => {
    const probeFile = join(homedir(), ".probe-home-isolation");
    // The probe path itself must sit under the sandbox root, not under whatever
    // HOME resolved to before this test's beforeEach ran (the real home never
    // matches this prefix).
    expect(probeFile.startsWith(SANDBOX_PREFIX)).toBe(true);
    try {
      writeFileSync(probeFile, "b-120-probe", "utf-8");
      expect(existsSync(probeFile)).toBe(true);
      expect(readFileSync(probeFile, "utf-8")).toBe("b-120-probe");
    } finally {
      rmSync(probeFile, { force: true });
    }
  });
});
