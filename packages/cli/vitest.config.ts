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
  },
  define: {
    __SDK_VERSION__: JSON.stringify(sdkPkg.version),
    __CLI_VERSION__: JSON.stringify(cliPkg.version),
  },
});
