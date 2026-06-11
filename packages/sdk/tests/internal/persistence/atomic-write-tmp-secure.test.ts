/**
 * T5.7 — Crypto-random tmp file names + mode 0o600 (DR6 finding #7).
 *
 * Pre-T5.7 `replaceFileAtomic` had two attacks open:
 *
 * (a) Predictable tmp path. `${filePath}.${process.pid}.${Math.random()
 *     .toString(36).slice(2, 10)}.tmp` uses Math.random which is NOT
 *     a CSPRNG — an attacker observing the process (e.g., via a
 *     side-channel into the PID + Math.random state) can predict the
 *     next tmp path and pre-stage a hostile file there to be renamed
 *     into place. Mitigation: replace the random component with
 *     `crypto.randomBytes(8).toString("hex")` (16 hex chars / 64 bits
 *     of unpredictable entropy).
 *
 * (b) World-readable tmp file. `open(tmp, "w")` falls back to the
 *     process umask — typically 0o644 on POSIX (world-readable). The
 *     tmp file holds the FULL in-flight content (credential pool
 *     snapshot, OAuth tokens, etc.) before the rename. Any process
 *     can read it during the ms-window between open and rename — a
 *     TOCTOU disclosure. Mitigation: pass `mode: 0o600` so the tmp
 *     (and post-rename final file) is owner-readable only.
 *
 * Also covers `saveCredentialPoolStore` parent dir creation: pre-T5.7
 * `mkdir(dirname, { recursive: true })` used default-mode (0o777 minus
 * umask). Tightened to `mode: 0o700` so the directory itself is
 * owner-only.
 */

import { mkdir, readFile, stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { replaceFileAtomic } from "../../../src/internal/persistence/atomic-write.js";

let testDir: string;
let target: string;

beforeEach(async () => {
  testDir = join(tmpdir(), `t57-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(testDir, { recursive: true });
  target = join(testDir, "secret.txt");
});

afterEach(async () => {
  await unlink(target).catch(() => undefined);
});

describe("T5.7 — replaceFileAtomic writes file with mode 0o600", () => {
  it("post-rename file mode is 0o600 (owner-only)", async () => {
    await replaceFileAtomic(target, "secret data");
    const info = await stat(target);
    // Mask off all but the permission bits.
    expect(info.mode & 0o777).toBe(0o600);
  });

  it("file content roundtrips correctly", async () => {
    await replaceFileAtomic(target, "hello world");
    const data = await readFile(target, "utf8");
    expect(data).toBe("hello world");
  });

  it("two concurrent writes do not collide on the tmp path", async () => {
    // With Math.random + same PID two parallel calls could pick the same
    // tmp suffix and one rename would race the other into ENOENT. With
    // crypto.randomBytes the collision probability is < 2^-64.
    await Promise.all([replaceFileAtomic(target, "first"), replaceFileAtomic(target, "second")]);
    const data = await readFile(target, "utf8");
    // Either content is acceptable — what matters is that neither call
    // threw (no ENOENT race).
    expect(["first", "second"]).toContain(data);
  });
});
