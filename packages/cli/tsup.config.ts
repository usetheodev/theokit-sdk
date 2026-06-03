import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

/**
 * Tsup config for @theokit/cli.
 *
 * Two entries:
 *  - `index.ts` — programmatic library API (exports `main`).
 *  - `bin/theokit.ts` — executable with shebang preserved.
 *
 * `SDK_VERSION` is injected at build time (EC-L fix from edge-case review):
 * `init` templates substitute `{{sdkVersion}}` with a real semver from the
 * sibling SDK package — NEVER `workspace:*`, which would break scaffolded
 * projects outside the monorepo.
 */
function readSdkVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL("../sdk/package.json", import.meta.url), "utf8")) as {
    version: string;
  };
  return pkg.version;
}

export default defineConfig({
  entry: { index: "src/index.ts", "bin/theokit": "src/bin/theokit.ts" },
  format: ["esm", "cjs"],
  dts: { entry: { index: "src/index.ts" } },
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: false,
  outDir: "dist",
  target: "node22",
  platform: "node",
  external: ["@theokit/sdk", "@clack/prompts", "commander", "picocolors", "tsx", "zod"],
  define: {
    __SDK_VERSION__: JSON.stringify(readSdkVersion()),
    __CLI_VERSION__: JSON.stringify(
      (
        JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
          version: string;
        }
      ).version,
    ),
  },
  banner: ({ format }) => ({
    js: format === "esm" ? "" : "",
  }),
  // Preserve shebang on the bin entry.
  esbuildOptions(options) {
    options.banner = options.banner ?? {};
    options.banner.js = "";
  },
});
