#!/usr/bin/env node
// Cross-cluster import guard (ADR D433, plan monorepo-cohesion-split).
// Fails if any Harness package under packages/*/src imports a cluster that was
// extracted to a sibling repo. Cohesion regression must fail loud — a human
// re-coupling the Harness to backend-dx / gateways / react / rag / voice /
// skills-google-workspace has to edit this guard on purpose.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const FORBIDDEN = [
  "@theokit/di",
  "@theokit/di-agent",
  "@theokit/orm",
  "@theokit/react",
  "@theokit/rag",
  "@theokit/voice",
  "@theokit/skills-google-workspace",
  // gateway core + any gateway-<platform> adapter, including sub-path imports
  // (e.g. "@theokit/gateway-telegram/dist") — F-arch-1: the previous $-anchored
  // form let sub-path re-coupling slip through.
  /^@theokit\/gateway(-[a-z]+)?(\/.*)?$/,
];

// Static import / re-export anchored at line start (so import-like text inside
// a string literal — e.g. a CLI help message — is NOT matched), plus dynamic
// import() preceded by a statement boundary (await / = / ( / line start).
const STATIC_RE = /^[ \t]*(?:import|export)\b[^\n]*?\bfrom\s*["']([^"']+)["']/gm;
const DYNAMIC_RE = /(?:^|[\s=(,;])import\(\s*["']([^"']+)["']\s*\)/g;

const PKGS_ROOT = new URL("../packages/", import.meta.url).pathname;

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === "dist" || entry === "coverage") continue;
      yield* walk(full);
    } else if (/\.(ts|tsx|mts|cts)$/.test(entry) && !/\.test\.|\.spec\./.test(entry)) {
      yield full;
    }
  }
}

function isForbidden(spec) {
  return FORBIDDEN.some((f) =>
    f instanceof RegExp ? f.test(spec) : spec === f || spec.startsWith(`${f}/`),
  );
}

const violations = [];
for (const pkg of readdirSync(PKGS_ROOT)) {
  const srcDir = join(PKGS_ROOT, pkg, "src");
  let st;
  try {
    st = statSync(srcDir);
  } catch {
    continue;
  }
  if (!st.isDirectory()) continue;
  for (const file of walk(srcDir)) {
    const text = readFileSync(file, "utf8");
    for (const re of [STATIC_RE, DYNAMIC_RE]) {
      for (const m of text.matchAll(re)) {
        const spec = m[1];
        if (spec && isForbidden(spec)) {
          violations.push(
            `${file.replace(PKGS_ROOT, "packages/")}: imports extracted cluster "${spec}"`,
          );
        }
      }
    }
  }
}

if (violations.length > 0) {
  console.error("Cross-cluster guard FAILED — the Harness must not import an extracted cluster:");
  for (const v of violations) console.error(`  - ${v}`);
  console.error(
    "\nFix: remove the import, or (if re-coupling is intentional) edit tools/check-cross-cluster.mjs.",
  );
  process.exit(1);
}

console.log("Cross-cluster guard PASS — no Harness file imports an extracted cluster.");
