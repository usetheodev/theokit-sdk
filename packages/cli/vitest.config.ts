import { readFileSync } from "node:fs";
import { cpus } from "node:os";
import { defineConfig } from "vitest/config";

/**
 * Vitest config for @theokit/cli.
 *
 * `define` mirrors tsup so tests use the same `__SDK_VERSION__` /
 * `__CLI_VERSION__` constants the production build sees.
 */
const sdkPkg = JSON.parse(
  readFileSync(new URL("../sdk/package.json", import.meta.url), "utf8"),
) as { version: string };
const cliPkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

export default defineConfig({
  test: {
    // Default is os.availableParallelism(): one fork per core, each booting a full
    // test environment. Capping leaves headroom for the host, and costs no wall-clock
    // because the gain above this point was already noise when measured.
    maxWorkers: Math.max(2, cpus().length - 4),
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // CLI tests spawn tsx subprocesses, run pnpm exec, and exercise file
    // IO under parallel workspace load. The default 5s timeout flakes
    // when SDK tests (1700+) share the CPU. 30s is generous for any
    // CLI surface without masking genuine hangs.
    testTimeout: 30_000,
  },
  define: {
    __SDK_VERSION__: JSON.stringify(sdkPkg.version),
    __CLI_VERSION__: JSON.stringify(cliPkg.version),
  },
});
