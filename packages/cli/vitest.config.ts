import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

/**
 * Vitest config for @usetheo/cli.
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
