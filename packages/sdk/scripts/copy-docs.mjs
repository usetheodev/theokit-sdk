#!/usr/bin/env node
/**
 * Copy the SDK reference docs into the package so they ship in the npm tarball.
 *
 * The docs live at the REPO ROOT (`docs/`) because they are linked from the root
 * README/CONTRIBUTING/CLAUDE.md, but npm's `files` field cannot reach outside the
 * package directory — so `build` copies them to `packages/sdk/docs/` (gitignored,
 * a pure build artifact, same pattern as `cp provider-catalog.json dist/`).
 *
 * Repo-relative links (`](../packages/...)`) are rewritten to absolute GitHub URLs
 * so they still resolve once the file is inside node_modules.
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
const SRC_DIR = join(REPO_ROOT, "docs");
const OUT_DIR = join(PKG_ROOT, "docs");

/** Reference docs shipped to consumers. The `docs/README.md` nav page is repo-only. */
const DOCS = ["harness-capability-map.md", "error-codes.md"];

const GITHUB_BLOB = "https://github.com/usetheodev/theokit-sdk/blob/main/";

/** `](../packages/sdk/README.md)` → absolute GitHub URL (resolves from node_modules). */
function absolutizeRepoLinks(markdown) {
  return markdown.replace(/\]\(\.\.\/([^)]+)\)/g, `](${GITHUB_BLOB}$1)`);
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
