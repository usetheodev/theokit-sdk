import { defineConfig } from "tsup";

/**
 * Shared tsup build configuration factory.
 * Consolidates duplicated tsup.config.ts files (60L × 4 = 240L).
 */
export function createTsupConfig(overrides?: any) {
  return defineConfig({
    entry: { index: "src/index.ts", ...overrides?.entry },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: true,
    treeshake: true,
    splitting: false,
    outDir: "dist",
    target: "node22",
    platform: "node",
    external: [],
    ...overrides,
  });
}
