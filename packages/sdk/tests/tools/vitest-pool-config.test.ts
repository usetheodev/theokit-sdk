/**
 * T3.1 TDD (v1.1 EC-4) — Vitest config shape sanity.
 *
 * Pins the `poolMatchGlobs` shape so a future vitest major-bump that
 * renames/restructures the API surfaces here as a build failure instead of
 * being silently ignored (running everything in `threads` again).
 */

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

describe("vitest config — poolMatchGlobs (T3.1)", () => {
  it("loads the SDK vitest config without throwing", async () => {
    const mod = await import(resolve(__dirname, "../../vitest.config.ts"));
    expect(mod.default).toBeDefined();
  });

  it("declares poolMatchGlobs as [pattern, pool] tuple array (vitest 3.x shape)", async () => {
    const mod = await import(resolve(__dirname, "../../vitest.config.ts"));
    const config = mod.default as {
      test?: {
        poolMatchGlobs?: ReadonlyArray<readonly [string, string]>;
      };
    };
    const globs = config.test?.poolMatchGlobs;
    expect(Array.isArray(globs)).toBe(true);
    if (!Array.isArray(globs)) return;
    expect(globs.length).toBeGreaterThan(0);
    for (const entry of globs) {
      expect(Array.isArray(entry)).toBe(true);
      expect(entry.length).toBe(2);
      expect(typeof entry[0]).toBe("string");
      expect(typeof entry[1]).toBe("string");
    }
  });

  it("routes tests/integration/** to forks", async () => {
    const mod = await import(resolve(__dirname, "../../vitest.config.ts"));
    const config = mod.default as {
      test?: {
        poolMatchGlobs?: ReadonlyArray<readonly [string, string]>;
        poolOptions?: { forks?: { singleFork?: boolean } };
      };
    };
    const integration = config.test?.poolMatchGlobs?.find(
      ([pattern]) => pattern === "tests/integration/**",
    );
    expect(integration?.[1]).toBe("forks");
    expect(config.test?.poolOptions?.forks?.singleFork).toBe(true);
  });
});
