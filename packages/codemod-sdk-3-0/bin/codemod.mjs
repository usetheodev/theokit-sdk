#!/usr/bin/env node
import { dirname, resolve } from "node:path";
/**
 * @theokit/codemod-sdk-3-0 — CLI wrapper around the SE36 jscodeshift transform.
 *
 * Usage:
 *   npx @theokit/codemod-sdk-3-0                 # dry-run on cwd
 *   npx @theokit/codemod-sdk-3-0 --write         # apply in place
 *   npx @theokit/codemod-sdk-3-0 --root src      # target a directory
 *
 * Exit code: 0 clean run; 1 invocation/transform error.
 */
import { fileURLToPath } from "node:url";
import { run as jscodeshift } from "jscodeshift/src/Runner.js";

const args = process.argv.slice(2);
const WRITE = args.includes("--write");
const rootIdx = args.indexOf("--root");
const target = resolve(rootIdx >= 0 && args[rootIdx + 1] ? args[rootIdx + 1] : ".");
const transformPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "transform.mjs");

try {
  const res = await jscodeshift(transformPath, [target], {
    parser: "tsx",
    extensions: "ts,tsx,mts,cts,js,mjs,cjs",
    dry: !WRITE,
    print: !WRITE,
    silent: false,
    ignorePattern: ["**/node_modules/**", "**/dist/**", "**/build/**"],
  });
  if (!WRITE) {
    console.log("\nDry-run complete. Re-run with --write to apply.");
  }
  process.exit(res.error > 0 ? 1 : 0);
} catch (err) {
  console.error("codemod failed:", err?.message ?? err);
  process.exit(1);
}
