/**
 * T3.1 TDD (v1.1 EC-4) — Vitest config shape sanity.
 *
 * Pins the pool configuration so a future vitest major-bump that
 * renames/restructures the API surfaces here as a build failure instead of
 * being silently ignored (running everything in `threads` again).
 *
 * theokit-sdk-biome-cleanup 2026-05-30 — `poolMatchGlobs` is deprecated in
 * vitest 3.x. The whole SDK suite now runs in the forks pool via top-level
 * `pool: "forks"` + `poolOptions.forks.singleFork: true` + `fileParallelism:
 * false`. The deprecated `poolMatchGlobs` is kept for backward visibility.
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

  it("declares singleFork: false for per-file process isolation", async () => {
    const mod = await import(resolve(__dirname, "../../vitest.config.ts"));
    const config = mod.default as {
      test?: { poolOptions?: { forks?: { singleFork?: boolean } } };
    };
    // theokit-sdk-biome-cleanup 2026-05-30 — flipped from `true` to `false`
    // so each test file gets its own subprocess. This is the only reliable
    // way to isolate `process.env.HOME` mutations across files. The whole
    // suite still runs in the forks pool (separate from threads).
    expect(config.test?.poolOptions?.forks?.singleFork).toBe(false);
  });

  it("declares fileParallelism: false for strict file-level serial execution", async () => {
    const mod = await import(resolve(__dirname, "../../vitest.config.ts"));
    const config = mod.default as {
      test?: { fileParallelism?: boolean };
    };
    expect(config.test?.fileParallelism).toBe(false);
  });
});
