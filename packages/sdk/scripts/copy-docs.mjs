#!/usr/bin/env node
/**
 * Copy the SDK reference docs into the package so they ship in the npm tarball.
 *
 * The docs live at the REPO ROOT, in the OKF wiki bundle (`wiki/reference/`), because
 * they are linked from the root README/CONTRIBUTING/CLAUDE.md and cross-linked from the
 * rest of the wiki — but npm's `files` field cannot reach outside the package directory,
 * so `build` copies them to `packages/sdk/docs/` (gitignored, a pure build artifact,
 * same pattern as `cp provider-catalog.json dist/`).
 *
 * Wiki-relative links (`](../sdk/import-map.md)`) point at sibling wiki folders that do
 * NOT ship, so they are rewritten to absolute GitHub URLs under `wiki/` and still resolve
 * once the file is inside node_modules. Links between the two shipped docs are written
 * `./name.md` and deliberately left alone — both files land side by side in the tarball.
 *
 * Fails loudly (exit 1) if a source doc is missing — a silently doc-less tarball
 * would be worse than a failed build.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(HERE, "..");
const REPO_ROOT = join(PKG_ROOT, "..", "..");
const SRC_DIR = join(REPO_ROOT, "wiki", "reference");
const OUT_DIR = join(PKG_ROOT, "docs");

/** Reference concepts shipped to consumers. The `wiki/reference/index.md` nav page is repo-only. */
const DOCS = ["harness-capability-map.md", "error-codes.md"];

const GITHUB_BLOB = "https://github.com/usetheodev/theokit-sdk/blob/main/";

/**
 * `](../sdk/import-map.md)` → absolute GitHub URL (resolves from node_modules).
 * The sources live in `wiki/reference/`, so one `../` lands in `wiki/`.
 */
function absolutizeRepoLinks(markdown) {
  return markdown.replace(/\]\(\.\.\/([^)]+)\)/g, `](${GITHUB_BLOB}wiki/$1)`);
}

mkdirSync(OUT_DIR, { recursive: true });

for (const name of DOCS) {
  const src = join(SRC_DIR, name);
  if (!existsSync(src)) {
    console.error(`[copy-docs] FATAL: missing source doc ${src}`);
    process.exit(1);
  }
  const out = join(OUT_DIR, name);
  const raw = readFileSync(src, "utf-8");
  const rewritten = absolutizeRepoLinks(raw);
  if (rewritten === raw) {
    copyFileSync(src, out);
  } else {
    writeFileSync(out, rewritten);
  }
}

console.log(`[copy-docs] copied ${DOCS.length} reference docs → packages/sdk/docs/`);
