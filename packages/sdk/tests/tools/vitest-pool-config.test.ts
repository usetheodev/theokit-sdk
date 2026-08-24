/**
 * T3.1 TDD (v1.1 EC-4) — Vitest config shape sanity.
 *
 * Pins the pool configuration so a future vitest major-bump that
 * renames/restructures the API surfaces here as a build failure instead of
 * being silently ignored (running everything in `threads` again).
 *
 * theokit-sdk-biome-cleanup 2026-05-30 — `poolMatchGlobs` is deprecated in
 * vitest 3.x. The whole SDK suite now runs in the forks pool via top-level
 * `pool: "forks"`.
 *
 * B-104, 2026-08-19 — Vitest 4 removed `test.poolOptions` entirely
 * (`singleFork`/`minForks`/`maxForks` do not exist anywhere in its dist;
 * see vitest.config.ts for the measurement). The `singleFork: false` pin
 * below was replaced with its actual top-level Vitest 4 successor,
 * `isolate: true` — both mean "each test file gets its own subprocess".
 *
 * B-059, 2026-08-20 — `fileParallelism` flipped `false` → `true`. The HOME-race
 * leaks that justified strict file-level serialization were independently
 * closed by B-120/B-117, and `isolate: true` (per-file subprocess) was always
 * the thing that actually prevented cross-file HOME races, not file-level
 * ordering. A real race WAS found and fixed in the process —
 * `tests/internal/memory/adapters/embedding-wire-contract.test.ts` shared a
 * mutable counter across concurrent `it()` bodies — see that file and
 * `vitest.config.ts` for the measurement. This test now pins `true`.
 */

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

describe("vitest config — pool configuration (T3.1)", () => {
  it("loads the SDK vitest config without throwing", async () => {
    const mod = await import(resolve(__dirname, "../../vitest.config.ts"));
    expect(mod.default).toBeDefined();
  });

  it("declares pool: 'forks' at top level (HOME-race + libuv-saturation fix)", async () => {
    const mod = await import(resolve(__dirname, "../../vitest.config.ts"));
    const config = mod.default as {
      test?: { pool?: string };
    };
    expect(config.test?.pool).toBe("forks");
  });

  it("declares isolate: true for per-file process isolation", async () => {
    const mod = await import(resolve(__dirname, "../../vitest.config.ts"));
    const config = mod.default as {
      test?: { isolate?: boolean };
    };
    // B-104, 2026-08-19 — top-level `isolate: true` is Vitest 4's
    // replacement for the removed `poolOptions.forks.singleFork: false`.
    // Each test file gets its own subprocess, which is the only reliable
    // way to isolate `process.env.HOME` mutations across files. The whole
    // suite still runs in the forks pool (separate from threads).
    expect(config.test?.isolate).toBe(true);
  });

  it("does not declare poolOptions (removed in Vitest 4, dead since B-104)", async () => {
    const mod = await import(resolve(__dirname, "../../vitest.config.ts"));
    const config = mod.default as { test?: { poolOptions?: unknown } };
    // Vitest 4 only reads `poolOptions` to log a DEPRECATED warning — nothing
    // inside it takes effect. Declaring it here would silently resurrect the
    // dead config this item removed.
    expect(config.test?.poolOptions).toBeUndefined();
  });

  it("declares fileParallelism: true (B-059 — file-level races were closed, isolate: true still holds)", async () => {
    const mod = await import(resolve(__dirname, "../../vitest.config.ts"));
    const config = mod.default as {
      test?: { fileParallelism?: boolean };
    };
    expect(config.test?.fileParallelism).toBe(true);
  });

  it("declares maxConcurrency: 1 (within-file concurrency stays capped in the default gate)", async () => {
    const mod = await import(resolve(__dirname, "../../vitest.config.ts"));
    const config = mod.default as {
      test?: { maxConcurrency?: number };
    };
    // The harder setting (maxConcurrency: 5 + sequence.shuffle: true) is
    // deliberately confined to vitest.shuffle.config.ts's periodic,
    // non-blocking probe — never the push/PR gate. See that file's own
    // doc-comment and B-059's measurement in vitest.config.ts.
    expect(config.test?.maxConcurrency).toBe(1);
  });
});
