import { cpus } from "node:os";
import { defineConfig } from "vitest/config";

/**
 * Shared vitest configuration factory used across all Theo test packages.
 * Consolidates duplicated vitest.config.ts files (previously 98L x 7 sites = 686L).
 *
 * Part of duplicate-code remediation Phase 4 (configuration files).
 *
 * @param overrides Optional vitest config overrides per package
 * @returns Vitest config object
 */
export function createVitestConfig(overrides?: any) {
  return defineConfig({
    test: {
      // Default is os.availableParallelism(): one fork per core, each booting a full
      // test environment. Capping leaves headroom for the host, and costs no wall-clock
      // because the gain above this point was already noise when measured.
      maxWorkers: Math.max(2, cpus().length - 4),
      environment: "node",
      include: ["tests/**/*.test.ts"],
      pool: "forks",
      ...overrides?.test,
    },
    ...overrides,
  });
}
