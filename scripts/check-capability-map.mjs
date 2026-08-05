#!/usr/bin/env node
// V2-3 — Capability-map resolve-check.
// Extracts every `import { ... } from "@theokit/sdk*"` / "@theokit/sdk-tools"
// in docs/harness-capability-map.md and verifies each named symbol resolves.
// `@theokit/sdk*` is checked from packages/sdk (self-reference resolves there);
// `@theokit/sdk-tools` from packages/sdk-tools. Exits non-zero on any unresolved
// symbol so the map can never document a non-existent import.
//
// Usage: node scripts/check-capability-map.mjs   (run from repo root, after `pnpm --filter @theokit/sdk build`)

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MAP = join(ROOT, "docs", "harness-capability-map.md");

const IMPORT_RE = /import\s*\{([\s\S]*?)\}\s*from\s*["'](@theokit\/sdk[^"']*|@theokit\/sdk-tools)["']/g;

function extract(mode) {
  const md = readFileSync(MAP, "utf8");
  const specs = new Map(); // spec → Set<symbol>
  let m;
  while ((m = IMPORT_RE.exec(md)) !== null) {
    const spec = m[2];
    const isTools = spec === "@theokit/sdk-tools";
    if (mode === "sdk" && isTools) continue;
    if (mode === "tools" && !isTools) continue;
    // theokit#156 — TYPE-only entries are skipped. This check resolves each symbol at RUNTIME
    // (`await import(spec)` + `n in mod`), and a TypeScript type does not exist there: asserting its
    // runtime presence is a category error, and it turned the gate red the first time the map
    // documented one. Types are still validated — by `tsc` and by the dts bundle, which is where
    // they can be.
    const names = m[1]
      .split("\n")
      .map((l) => l.replace(/\/\/.*$/, "")) // strip line comments first
      .join("\n")
      .split(",")
      .filter((s) => !/\btype\b/.test(s))
      .map((s) => s.trim())
      .filter((n) => /^[A-Za-z_$][\w$]*$/.test(n));
    if (!specs.has(spec)) specs.set(spec, new Set());
    for (const n of names) specs.get(spec).add(n);
  }
  return specs;
}

// The actual import + check runs in a child process whose CWD makes the bare
// specifier resolve (sdk self-references from packages/sdk; sdk-tools from its dir).
function runChild(mode, cwd) {
  const specs = extract(mode);
  const payload = JSON.stringify([...specs].map(([s, set]) => [s, [...set]]));
  const child = `
    const specs = ${payload};
    let fails = 0, checked = 0;
    for (const [spec, names] of specs) {
      let mod;
      try { mod = await import(spec); }
      catch (e) { console.log('SPEC FAIL ' + spec + ': ' + (e.code||e.message)); fails += names.length; continue; }
      for (const n of names) { checked++; if (!(n in mod)) { console.log('MISSING ' + n + ' from ' + spec); fails++; } }
    }
    console.log('[${mode}] symbols-checked=' + checked + ' fails=' + fails + ' ' + (fails===0?'PASS':'FAIL'));
    process.exit(fails===0?0:1);
  `;
  const res = spawnSync("node", ["--input-type=module", "-e", child], { cwd, stdio: "inherit" });
  return res.status ?? 1;
}

const sdkStatus = runChild("sdk", join(ROOT, "packages", "sdk"));
const toolsStatus = runChild("tools", join(ROOT, "packages", "sdk-tools"));
process.exit(sdkStatus === 0 && toolsStatus === 0 ? 0 : 1);
