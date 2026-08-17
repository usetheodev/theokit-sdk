/**
 * M2 #63 (adversarial-review evidence gap) — the cross-process file lock was
 * only ever exercised with in-process `Promise.all`, which would pass even with
 * zero cross-process protection. This spawns TWO REAL child processes that both
 * take the SDK's `withFileLock` on the same file, each writing a `start`/`end`
 * pair around a delay. If the lock works across processes, the two pairs are
 * CONTIGUOUS (no interleave). Requires `proper-lockfile` (present in this repo).
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const fileLockSrc = resolve(here, "../../../src/internal/persistence/file-lock.ts");
// This is the ONLY consumer of the root `tsx` devDependency, and it reaches it by resolved path
// rather than by import — which no static analyser can see. knip therefore reports `tsx` as an
// unused dependency; it is listed under `ignoreDependencies` in knip.json for exactly this reason.
// Dropping `tsx` from the root package.json makes this spawn fail with ENOENT, and because turbo
// serves a cached test result when no source file changed, `pnpm validate` can still report green
// while this test is broken. Removed once on 2026-08-17; CI caught it, the local gate did not.
const tsxBin = resolve(here, "../../../../../node_modules/.bin/tsx");

function childScript(target: string, marker: string): string {
  return `
    import { appendFileSync } from "node:fs";
    import { withFileLock } from ${JSON.stringify(fileLockSrc)};
    await withFileLock(${JSON.stringify(target)}, async () => {
      appendFileSync(${JSON.stringify(target)}, "start-${marker}\\n");
      await new Promise((r) => setTimeout(r, 80)); // hold the critical section
      appendFileSync(${JSON.stringify(target)}, "end-${marker}\\n");
    });
  `;
}

function runChild(scriptPath: string): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(tsxBin, [scriptPath], { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => resolvePromise(code ?? -1));
  });
}

describe("withFileLock cross-process mutual exclusion (#63)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "xproc-lock-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("serializes two separate processes writing under the lock (no interleave)", async () => {
    const target = join(dir, "shared.log");
    writeFileSync(target, "");
    const scriptA = join(dir, "a.mts");
    const scriptB = join(dir, "b.mts");
    writeFileSync(scriptA, childScript(target, "A"));
    writeFileSync(scriptB, childScript(target, "B"));

    const [codeA, codeB] = await Promise.all([runChild(scriptA), runChild(scriptB)]);
    expect(codeA).toBe(0);
    expect(codeB).toBe(0);

    const [l0, l1, l2, l3] = readFileSync(target, "utf8").trim().split("\n");
    expect([l0, l1, l2, l3].every((l) => l !== undefined)).toBe(true);
    // If the lock held cross-process, each start is immediately followed by its
    // OWN end — interleave (start-A, start-B, end-A, end-B) means the lock failed.
    expect(l0?.startsWith("start-")).toBe(true);
    expect(l1).toBe(`end-${(l0 ?? "").slice("start-".length)}`);
    expect(l2?.startsWith("start-")).toBe(true);
    expect(l3).toBe(`end-${(l2 ?? "").slice("start-".length)}`);
    // Both markers present.
    expect(new Set([l0, l2])).toEqual(new Set(["start-A", "start-B"]));
  }, 30_000);
});
