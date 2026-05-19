/**
 * Tests for theokit-migrate-config CLI (T4.1) + atomicWriteText helper.
 */

import { execSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { atomicWriteText, replaceFileAtomic } from "../../src/internal/persistence/atomic-write.js";

// Resolve CLI from this test file's location → bullet-proof across vitest cwds.
const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "..", "bin", "theokit-migrate-config.mjs");

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "migrate-config-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function runCli(args: string[] = []): { code: number; stdout: string; stderr: string } {
  const result = spawnSync("node", [CLI, "--cwd", dir, ...args], { encoding: "utf8" });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("theokit-migrate-config CLI", () => {
  it("(EC-8) workspace without .theokit/ → graceful exit 'nothing to migrate'", () => {
    const result = runCli();
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/Nothing to migrate/);
  });

  it("dry-run prints plan but doesn't write", () => {
    mkdirSync(join(dir, ".theokit"), { recursive: true });
    writeFileSync(
      join(dir, ".theokit", "hooks.json"),
      JSON.stringify({
        hooks: {
          preToolUse: [{ matcher: "^shell$", command: "node policy.js" }],
        },
      }),
      "utf8",
    );
    const result = runCli();
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/dry-run/);
    expect(existsSync(join(dir, ".theokit", "hooks"))).toBe(false);
  });

  it("--apply writes MD files + creates timestamped backup", () => {
    mkdirSync(join(dir, ".theokit"), { recursive: true });
    writeFileSync(
      join(dir, ".theokit", "hooks.json"),
      JSON.stringify({
        hooks: { preToolUse: [{ matcher: "^shell$", command: "node policy.js" }] },
      }),
      "utf8",
    );
    const result = runCli(["--apply"]);
    expect(result.code).toBe(0);
    expect(existsSync(join(dir, ".theokit", "hooks", "preToolUse-1.md"))).toBe(true);
    // Backup has timestamp suffix (.<unix-ts>.bak), not bare .bak (EC-19 fix)
    expect(existsSync(join(dir, ".theokit", "hooks.json"))).toBe(false); // original renamed
    const files = execSync(`ls ${dir}/.theokit/`, { encoding: "utf8" });
    expect(files).toMatch(/hooks\.json\.\d+\.bak/);
  });

  it("(EC-9) aborts when destination MD already exists", () => {
    mkdirSync(join(dir, ".theokit", "hooks"), { recursive: true });
    writeFileSync(
      join(dir, ".theokit", "hooks", "preToolUse-1.md"),
      `---\nevent: preToolUse\nmatcher: ^x$\ncommand: echo\n---\n`,
      "utf8",
    );
    writeFileSync(
      join(dir, ".theokit", "hooks.json"),
      JSON.stringify({
        hooks: { preToolUse: [{ matcher: "^shell$", command: "node policy.js" }] },
      }),
      "utf8",
    );
    const result = runCli(["--apply"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/Pre-flight aborted|already exist/);
  });

  it("migrates context.json + plugin.json together", () => {
    mkdirSync(join(dir, ".theokit", "plugins", "openrouter"), { recursive: true });
    writeFileSync(
      join(dir, ".theokit", "context.json"),
      JSON.stringify({ sources: [{ name: "readme", path: "README.md" }] }),
      "utf8",
    );
    writeFileSync(
      join(dir, ".theokit", "plugins", "openrouter", "plugin.json"),
      JSON.stringify({ name: "openrouter", version: "1.0", entry: "index.js" }),
      "utf8",
    );
    const result = runCli(["--apply"]);
    expect(result.code).toBe(0);
    expect(existsSync(join(dir, ".theokit", "context", "readme.md"))).toBe(true);
    expect(existsSync(join(dir, ".theokit", "plugins", "openrouter", "PLUGIN.md"))).toBe(true);
  });

  it("--no-backup skips .bak rename", () => {
    mkdirSync(join(dir, ".theokit"), { recursive: true });
    writeFileSync(
      join(dir, ".theokit", "hooks.json"),
      JSON.stringify({
        hooks: { preToolUse: [{ matcher: "^shell$", command: "echo" }] },
      }),
      "utf8",
    );
    const result = runCli(["--apply", "--no-backup"]);
    expect(result.code).toBe(0);
    expect(existsSync(join(dir, ".theokit", "hooks.json"))).toBe(true); // not backed up
  });
});

describe("atomicWriteText helper (EC-2 fix)", () => {
  it("writes content atomically", async () => {
    const target = join(dir, "sub", "file.md");
    await atomicWriteText(target, "hello world");
    expect(readFileSync(target, "utf8")).toBe("hello world");
  });

  it("auto-creates parent dir", async () => {
    const target = join(dir, "a", "b", "c", "file.md");
    await atomicWriteText(target, "deep");
    expect(readFileSync(target, "utf8")).toBe("deep");
  });

  it("replaceFileAtomic exists and works (legacy helper unchanged)", async () => {
    const target = join(dir, "existing.txt");
    writeFileSync(target, "old", "utf8");
    await replaceFileAtomic(target, "new");
    expect(readFileSync(target, "utf8")).toBe("new");
  });
});
