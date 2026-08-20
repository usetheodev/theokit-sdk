/**
 * T0.3 — Chaos: simulated filesystem partition.
 *
 * When the workspace `.theokit/memory/` directory becomes unwritable mid-run
 * (think: disk full, NFS mount drop, container OOM-kill), the SDK MUST
 * surface a typed error rather than crashing the agent loop. This scaffold
 * proves the harness can simulate the failure via `chmod 0o000` and that
 * a wrapped `mkdir` call surfaces a recognizable error code.
 *
 * T6.4 wires this against the SDK's real persistence paths (memory writes,
 * session summary writes) and asserts move-corrupt-aside + recovery.
 */

import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SKIP_CHAOS = process.env.SKIP_T0_3_CHAOS === "1";

/**
 * Root bypasses directory-mode permission bits, so `mkdir` under a 0o000
 * parent succeeds and there is no EACCES to observe. Gate the test at
 * collection time so such a runner reports it SKIPPED — a silent `return`
 * here would report PASS for an assertion that never ran.
 */
const RUNNING_AS_ROOT = process.getuid?.() === 0;

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "theokit-partition-fs-"));
});

afterEach(async () => {
  try {
    await chmod(dir, 0o700);
  } catch {
    // best-effort restore
  }
  await rm(dir, { recursive: true, force: true });
});

describe.skipIf(SKIP_CHAOS)("T0.3 partition-fs chaos scaffold", () => {
  it.skipIf(RUNNING_AS_ROOT)("mkdir surfaces EACCES when parent dir is 0o000", async () => {
    await chmod(dir, 0o000);
    let caught: NodeJS.ErrnoException | undefined;
    try {
      await mkdir(join(dir, "child"));
    } catch (e) {
      caught = e as NodeJS.ErrnoException;
    }
    expect(caught).toBeDefined();
    expect(caught?.code).toMatch(/EACCES|EPERM/);
  });

  it.todo(
    "an unwritable .theokit/memory surfaces a typed error and moves the corrupt file aside — owner B-037, sunset 2026-11-19 (T6.4)",
  );
});
