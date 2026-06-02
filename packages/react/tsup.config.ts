import { defineConfig } from "tsup";

export default defineConfig({
  // Two architectural entry points (mirrors Next.js `next/server` split):
  //   - `@usetheo/react`         → client hooks only (no SDK imports)
  //   - `@usetheo/react/server`  → server route handlers (Agent runtime)
  // The split prevents node:fs / node:path from leaking into client bundles
  // when the consumer imports a client hook.
  entry: {
    index: "src/index.ts",
    server: "src/server.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  external: ["react", "@usetheo/sdk"],
});
