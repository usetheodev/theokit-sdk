/**
 * T1.1 TDD — Native bindings preflight unit tests.
 *
 * Tests the exported `findRebuildCwd` helper + the high-level behavior
 * surfaces. The full `ensureNativeBindings()` flow (spawnSync, exit) is
 * hard to unit-test in-process; we instead test its sub-parts and behavior
 * via integration in actual vitest runs (T5.1 dogfood).
 *
 * Run: pnpm exec vitest run tests/tools/preflight-native-bindings.test.ts
 */

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Preflight is plain ESM `.mjs` (no TypeScript at runtime — intentional;
// runs before any TS toolchain is bootstrapped). Types come from the
// hand-written `preflight-native-bindings.d.mts` ambient declaration next
// to the source.
import {
  ensureNativeBindings,
  findRebuildCwd,
} from "../../../../tools/preflight-native-bindings.mjs";

describe("findRebuildCwd (v1.1 EC-1 MUST FIX — workspace-link routing)", () => {
  let sandbox: string;
  let realRepo: string;
  let linkedRepo: string;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), "preflight-cwd-"));
    // Simulate: realRepo IS where better-sqlite3 lives (the sibling)
    realRepo = join(sandbox, "sibling-sdk");
    mkdirSync(
      join(
        realRepo,
        "node_modules/.pnpm/better-sqlite3@12.10.0/node_modules/better-sqlite3/build/Release",
      ),
      { recursive: true },
    );
    const binPath = join(
      realRepo,
      "node_modules/.pnpm/better-sqlite3@12.10.0/node_modules/better-sqlite3/build/Release/better_sqlite3.node",
    );
    writeFileSync(binPath, "fake-bin");

    // Simulate: linkedRepo (consumer) symlinks the sibling
    linkedRepo = join(sandbox, "consumer-repo");
    mkdirSync(join(linkedRepo, "node_modules/@usetheo"), { recursive: true });
    // Symlink that mimics how pnpm workspace link puts the sibling under
    // node_modules/@usetheo/sdk in the consumer.
    symlinkSync(realRepo, join(linkedRepo, "node_modules/@usetheo/sdk"));
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  it("resolves symlink to sibling repo (EC-1)", () => {
    // Given: a binding path under the symlinked @usetheo/sdk in the consumer
    const failingBindingPath = join(
      linkedRepo,
      "node_modules/@usetheo/sdk/node_modules/.pnpm/better-sqlite3@12.10.0/node_modules/better-sqlite3/build/Release/better_sqlite3.node",
    );

    // When: findRebuildCwd is called with a default cwd of the consumer repo
    const got = findRebuildCwd(failingBindingPath, linkedRepo);

    // Then: it returns the sibling SDK repo (realRepo) — where rebuild must run
    expect(got).toBe(realRepo);
  });

  it("returns default when binding is local (no regression for non-symlinked cases)", () => {
    // Given: a binding path inside the consumer's own node_modules (no link)
    const localBinDir = join(
      linkedRepo,
      "node_modules/.pnpm/better-sqlite3@12.10.0/node_modules/better-sqlite3/build/Release",
    );
    mkdirSync(localBinDir, { recursive: true });
    const localBin = join(localBinDir, "better_sqlite3.node");
    writeFileSync(localBin, "fake");

    // When
    const got = findRebuildCwd(localBin, linkedRepo);

    // Then: returns the default (consumer repo)
    expect(got).toBe(linkedRepo);
  });

  it("returns default when failingBindingPath is undefined (defensive)", () => {
    const got = findRebuildCwd(undefined, linkedRepo);
    expect(got).toBe(linkedRepo);
  });

  it("returns default when binding path does not exist (defensive)", () => {
    const bogus = join(sandbox, "does-not-exist/foo.node");
    const got = findRebuildCwd(bogus, linkedRepo);
    expect(got).toBe(linkedRepo);
  });
});

describe("preflight-native-bindings module shape", () => {
  it("exports findRebuildCwd + ensureNativeBindings", () => {
    expect(typeof findRebuildCwd).toBe("function");
    expect(typeof ensureNativeBindings).toBe("function");
  });

  it("ensureNativeBindings returns a Promise (async + sentinel fast-path)", async () => {
    // Sentinel exists (we're inside a vitest run that already loaded
    // better-sqlite3 successfully via the global setup). Calling again
    // should be a fast no-op resolving cleanly.
    const result = ensureNativeBindings();
    expect(result).toBeInstanceOf(Promise);
    await result;
  });
});
