import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
  },
  format: ["esm", "cjs"],
  dts: {
    entry: {
      index: "src/index.ts",
    },
  },
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: false,
  outDir: "dist",
  target: "node22",
  platform: "node",
  // EC-2 absorbed (SDK 2.0 plan T3.1): mark @theokit/* + heavy peers as
  // external so tsup does NOT bundle a copy of sdk-core (Agent, Plugin
  // foundation, persistence primitives) inside sdk-cache's dist. Without
  // this regex, the split's bundle-size win evaporates.
  external: [/^@theokit\//, "zod"],
  outExtension({ format }) {
    return { js: format === "esm" ? ".js" : ".cjs" };
  },
});
