#!/usr/bin/env node
// Mirror tools/* and path-safety .d.ts → .d.cts so the CJS condition in
// package.json `exports` resolves to a real `.d.cts` file. Without this,
// attw flags the sub-exports as "Masquerading as ESM" because CJS imports
// land on a `.d.ts` (ESM-shape) declaration file.
//
// Type-only TS code is syntax-identical between .d.ts and .d.cts; copying
// the file is sufficient.

import { copyFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, "..", "dist");

/** Recursively walk a dir collecting .d.ts files (excluding already-paired .d.cts). */
async function* walkDts(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkDts(full);
    } else if (entry.name.endsWith(".d.ts")) {
      yield full;
    }
  }
}

const targets = [
  // tools — EXTRACTED to @theokit/sdk-tools (SDK 2.0 split, Phase 5).
  join(DIST, "path-safety.d.ts"),
  join(DIST, "task-store.d.ts"),
  join(DIST, "workflow.d.ts"),
  join(DIST, "eval.d.ts"),
  join(DIST, "subscription"),
  // EC-1 absorbed: internal sub-paths exposed for extracted packages.
  join(DIST, "internal", "persistence"),
  join(DIST, "internal", "plugins"),
  join(DIST, "internal", "observability"),
  join(DIST, "internal", "security"),
];

for (const target of targets) {
  const dtsFiles = [];
  try {
    const stat = (await import("node:fs/promises")).stat;
    const info = await stat(target);
    if (info.isDirectory()) {
      for await (const file of walkDts(target)) dtsFiles.push(file);
    } else if (target.endsWith(".d.ts")) {
      dtsFiles.push(target);
    }
  } catch {
    // Skip missing targets — tsup may not have built them yet.
    continue;
  }
  for (const dts of dtsFiles) {
    const cts = dts.replace(/\.d\.ts$/, ".d.cts");
    await copyFile(dts, cts);
  }
}
