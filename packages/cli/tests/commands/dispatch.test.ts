/**
 * T1.1 — dispatch + flag tests.
 *
 * Verifies commander routes argv to the correct command handler and
 * passes parsed flags through.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { main } from "../../src/index.js";

let savedCwd: string;
let scratch: string;
beforeEach(() => {
  savedCwd = process.cwd();
  scratch = mkdtempSync(join(tmpdir(), "tk-dispatch-"));
  process.chdir(scratch);
});
afterEach(() => {
  process.chdir(savedCwd);
  rmSync(scratch, { recursive: true, force: true });
});

function captureStdout(): { write: typeof process.stdout.write; lines: string[] } {
  const lines: string[] = [];
  const write = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  }) as unknown as typeof process.stdout.write;
  return {
    write,
    lines,
  };
}

describe("commander dispatch (T1.1)", () => {
  it("dispatches `init` with project name + template flag", async () => {
    const out = captureStdout();
    const code = await main([
      "node",
      "theokit",
      "init",
      "my-bot",
      "--template",
      "minimal",
      "--yes",
    ]);
    expect(code).toBe(0);
    const joined = out.lines.join("");
    expect(joined).toContain("my-bot");
    expect(joined).toMatch(/Scaffolded|files written/);
    vi.restoreAllMocks();
  });

  it("dispatches `dev` and resolves entry from --entry flag (exits 2 when missing)", async () => {
    // scratch is empty → entry_not_found → exit 2. Proves dispatch reached
    // dev handler + entry-resolver logic without actually spawning tsx.
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const code = await main(["node", "theokit", "dev", "--entry", "missing-bot.ts"]);
    expect(code).toBe(2);
    stderrSpy.mockRestore();
  });

  // Real `dev` semantics (spawning tsx, env loading) are covered in
  // tests/dev/runner.test.ts which uses watch:false. The dispatch test
  // above (exits 2 with missing entry) is enough to prove the command
  // reaches the handler.

  it("dispatches `inspect` with --json flag", async () => {
    const out = captureStdout();
    const code = await main(["node", "theokit", "inspect", "--json"]);
    expect(code).toBe(0);
    const joined = out.lines.join("");
    expect(() => JSON.parse(joined.trim())).not.toThrow();
    vi.restoreAllMocks();
  });

  it("dispatches `eval` with --config flag (exits 2 on missing config)", async () => {
    // scratch has no eval config → config_not_found → exit 2. Proves
    // dispatch reached eval handler + config-loader logic.
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const code = await main(["node", "theokit", "eval", "--config", "my-eval.ts"]);
    expect(code).toBe(2);
    const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderr).toMatch(/config_not_found|not found/i);
    stderrSpy.mockRestore();
  });

  it("--version exits 0 with the CLI version", async () => {
    const out = captureStdout();
    const code = await main(["node", "theokit", "--version"]);
    expect(code).toBe(0);
    expect(out.lines.join("")).toMatch(/^\d+\.\d+\.\d+/);
    vi.restoreAllMocks();
  });

  it("top-level --help lists 4 subcommands", async () => {
    const out = captureStdout();
    const code = await main(["node", "theokit", "--help"]);
    expect(code).toBe(0);
    const joined = out.lines.join("");
    for (const cmd of ["init", "dev", "inspect", "eval"]) {
      expect(joined).toContain(cmd);
    }
    vi.restoreAllMocks();
  });

  it("unknown subcommand exits with code 2", async () => {
    // commander writes to stderr; silence both streams.
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const code = await main(["node", "theokit", "does-not-exist"]);
    expect(code).toBe(2);
    stderrSpy.mockRestore();
    stdoutSpy.mockRestore();
  });
});
