/**
 * T3.1 TDD (v1.1 EC-4) — Vitest config shape sanity.
 *
 * Pins the pool configuration so a future vitest major-bump that
 * renames/restructures the API surfaces here as a build failure instead of
 * being silently ignored (running everything in `threads` again).
 *
 * theokit-sdk-biome-cleanup 2026-05-30 — `poolMatchGlobs` is deprecated in
 * vitest 3.x. The whole SDK suite now runs in the forks pool via top-level
 * `pool: "forks"` + `fileParallelism: false`.
 *
 * B-104, 2026-08-19 — Vitest 4 removed `test.poolOptions` entirely
 * (`singleFork`/`minForks`/`maxForks` do not exist anywhere in its dist;
 * see vitest.config.ts for the measurement). The `singleFork: false` pin
 * below was replaced with its actual top-level Vitest 4 successor,
 * `isolate: true` — both mean "each test file gets its own subprocess".
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

  it("declares fileParallelism: false for strict file-level serial execution", async () => {
    const mod = await import(resolve(__dirname, "../../vitest.config.ts"));
    const config = mod.default as {
      test?: { fileParallelism?: boolean };
    };
    expect(config.test?.fileParallelism).toBe(false);
  });
});
