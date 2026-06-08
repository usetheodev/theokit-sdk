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
  // EC-2 absorbed (SDK 2.0 plan T3.1): mark @theokit/* as external so
  // tsup does NOT bundle a copy of sdk-core (Agent, Plugin foundation,
  // persistence primitives, MemoryProvider contract) inside sdk-memory's
  // dist. Without this regex, the split's bundle-size win evaporates.
  external: [/^@theokit\//],
  outExtension({ format }) {
    return { js: format === "esm" ? ".js" : ".cjs" };
  },
});
