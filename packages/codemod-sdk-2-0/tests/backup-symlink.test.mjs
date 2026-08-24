/**
 * The codemod writes `<path>.bak` before rewriting a file. `copyFile` follows symlinks, and that
 * name is predictable from a file anyone can see — so a symlink planted there received the
 * file's contents, anywhere on the filesystem the process could reach.
 *
 * This matters more here than in a library: the codemod runs on a CONSUMER's repository, so
 * "someone placed a file in the tree" is the ordinary situation, not a privileged one.
 *
 * Same defect and same fix as `@theokit/sdk-tools`' `edit_file` (434b25fc).
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BIN = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "codemod.mjs");

const root = mkdtempSync(join(tmpdir(), "codemod-symlink-"));
const outside = mkdtempSync(join(tmpdir(), "codemod-victim-"));
try {
  const victim = join(outside, "victim.txt");
  writeFileSync(victim, "PRISTINE", "utf8");
  const target = join(root, "app.ts");
  writeFileSync(target, 'import { Agent } from "@theokit/sdk";\n', "utf8");
  // The attacker plants the backup path ahead of the run.
  symlinkSync(victim, `${target}.bak`);

  let failed = false;
  try {
    execFileSync("node", [BIN, "--write", "--backup", "--root", root], { stdio: "pipe" });
  } catch {
    failed = true;
  }

  // Whatever the codemod decided to do, the file outside the tree must be untouched.
  assert.equal(readFileSync(victim, "utf8"), "PRISTINE", "backup was written through the symlink");
  assert.ok(failed, "the codemod should refuse the planted backup path rather than skip silently");
  console.log("backup-symlink test PASSED");
} finally {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
}
