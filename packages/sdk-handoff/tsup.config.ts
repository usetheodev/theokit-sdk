import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "internal/tool-injector": "src/internal/tool-injector.ts",
  },
  format: ["esm", "cjs"],
  dts: {
    entry: {
      index: "src/index.ts",
      "internal/tool-injector": "src/internal/tool-injector.ts",
    },
  },
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: false,
  outDir: "dist",
  target: "node22",
  platform: "node",
  // EC-2 absorbed (SDK 2.0 plan T4.1): mark @theokit/* + zod external
  // so tsup does NOT bundle a copy of sdk-core into sdk-handoff/dist.
  external: [/^@theokit\//, "zod"],
  outExtension({ format }) {
    return { js: format === "esm" ? ".js" : ".cjs" };
  },
});
