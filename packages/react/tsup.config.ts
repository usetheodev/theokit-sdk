import { defineConfig } from "tsup";

export default defineConfig({
  // Two architectural entry points (mirrors Next.js `next/server` split):
  //   - `@theokit/react`         → client hooks only (no SDK imports)
  //   - `@theokit/react/server`  → server route handlers (Agent runtime)
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
  external: ["react", "@theokit/sdk"],
});
