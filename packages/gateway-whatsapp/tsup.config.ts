import { copyFileSync, mkdirSync } from "node:fs";
import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: false,
  outDir: "dist",
  target: "node22",
  platform: "node",
  external: ["@theokit/gateway", "@theokit/sdk", "whatsapp-web.js"],
  onSuccess: async () => {
    // Copy the bridge subprocess script alongside the dist so `dist/bridge/whatsapp-web-bridge.mjs` is shipped.
    mkdirSync("dist/bridge", { recursive: true });
    copyFileSync("src/bridge/whatsapp-web-bridge.mjs", "dist/bridge/whatsapp-web-bridge.mjs");
  },
});
