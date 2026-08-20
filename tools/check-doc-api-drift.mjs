#!/usr/bin/env node

// Documentation-vs-API drift gate.
//
// Every scaffold template, README and shipped SKILL.md tells a consumer to write an import. Nothing
// checked that the names in those imports exist. Measured 2026-08-20: 13 did not, across 8 files,
// including the template `theokit init --template telegram-bot` scaffolds — it imported
// `createAgentFactory`, which the SE36 rename replaced with `AgentFactory.create` in v3.0. The
// project shipped a codemod for that rename (`@theokit/codemod-sdk-3-0`) and wrote the rule into
// `claude-template/AGENTS.md` ("NEVER author defineTool ... use Tool.create"), then left its own
// templates on the old names. A published example that does not compile is a first impression.
//
// The oracle is the COMPILER, not a regex over `.d.ts` text. A first version hand-parsed export
// clauses and reported `RetryOptions` as missing when `retry.d.ts` plainly exports it — the parser
// could not read the form it used. Matching names is precisely what fails here.
//
// Each `import { … } from "@theokit/…"` becomes one line in a generated probe; one `tsc --noEmit`
// over the probes says which names do not resolve, and each diagnostic maps back to its artifact.
//
// Two things it deliberately does NOT report:
//   - migration "Before (1.x):" fences, which document an incorrect line on purpose;
//   - a type imported where a value is expected — TypeScript erases those, and flagging them buried
//     the real findings 83-to-18 in an early run.
//
// It does not read prose. `Tool.create` written as `defineTool` in a sentence still slips past —
// the READMEs were swept by hand once for that, and the gap is stated here rather than implied.
//
// A specific instance of that gap: a SUBPATH named in prose rather than in an import. AGENTS.md
// lists eleven of them in one sentence ("Other public subpaths: /messages, /models, …"), and no
// check reaches them. All eleven were verified by hand on 2026-08-20 and all eleven resolve. A gate
// was considered and NOT built: catching this means telling a sentence that names a subpath from one
// that denies it exists ("There is **no** `@theokit/sdk/rag` subpath", in that same paragraph), and
// that is the same negation heuristic whose first version here hid a real finding behind the word
// "before" in ordinary prose. With zero measured instances of the defect, the heuristic is the
// larger risk. Re-open the decision when one appears.

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(process.argv[2] ?? ".");
const OUT = process.argv[3] ?? join(ROOT, ".api-drift-probe");
const PACKAGES = join(ROOT, "packages");

/** Local package names, so third-party specifiers are skipped. */
function localPackageNames() {
  const names = [];
  for (const entry of readdirSync(PACKAGES)) {
    const m = join(PACKAGES, entry, "package.json");
    if (!existsSync(m)) continue;
    const manifest = JSON.parse(readFileSync(m, "utf8"));
    if (manifest.private !== true && typeof manifest.name === "string") names.push(manifest.name);
  }
  return names;
}

function walk(dir, accept, out = [], depth = 0) {
  if (depth > 6 || !existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, accept, out, depth + 1);
    else if (accept(entry)) out.push(p);
  }
  return out;
}

function consumerFiles() {
  const files = [];
  const code = (n) => /\.(ts|tsx|mts|js|mjs)$/.test(n);
  const md = (n) => n.endsWith(".md");
  for (const d of [
    "packages/sdk/templates",
    "packages/cli/templates",
    "packages/sdk/claude-template",
  ]) {
    walk(join(ROOT, d), (n) => code(n) || md(n), files);
  }
  walk(ROOT, (n) => n === "README.md", files);
  return [...new Set(files)];
}

const LOCAL = localPackageNames();
const isLocal = (s) => LOCAL.some((n) => s === n || s.startsWith(`${n}/`));

/**
 * Markdown fences a migration guide deliberately shows as WRONG.
 *
 * `sdk-cache`, `sdk-handoff` and `sdk-tools` each open a "Before (1.x):" block with the old import,
 * immediately followed by "After (2.x):" with the current one. Those are correct documentation of an
 * incorrect line — reporting them is the instrument failing to read, not the docs failing to be
 * true. Four of the first seventeen findings were exactly that.
 *
 * Detection is the heading or prose introducing the fence, which is where the intent is stated.
 */
// A LABEL LINE, not prose. The first version matched the word anywhere in the two preceding lines,
// so "measure quality, latency, and cost BEFORE shipping" hid a real finding one line below it —
// a false negative introduced while removing false positives, which is the worse trade of the two.
// The genuine marker is a short line that exists only to label the fence: `Before (1.x):`.
const DEPRECATED_FENCE = /^(before|old|legacy|deprecated|don'?t|do not|instead of|❌)\b.{0,40}:$/i;

/** Character offsets of fenced code blocks a migration guide marks as the OLD way. */
function deprecatedRanges(text) {
  const ranges = [];
  const fence = /```[a-z]*\n([\s\S]*?)```/g;
  for (const m of text.matchAll(fence)) {
    const before = text.slice(Math.max(0, m.index - 200), m.index);
    const lines = before.split("\n").filter((l) => l.trim().length > 0);
    const lead = lines.at(-1)?.trim() ?? "";
    if (DEPRECATED_FENCE.test(lead)) ranges.push([m.index, m.index + m[0].length]);
  }
  return ranges;
}

/** `import { a, b as c } from "x"` — value and type forms alike. */
function importsIn(text) {
  const found = [];
  const skip = deprecatedRanges(text);
  const inSkipped = (i) => skip.some(([a, b]) => i >= a && i < b);
  for (const m of text.matchAll(/import\s*(?:type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) {
    if (inSkipped(m.index)) continue;
    const names = m[1]
      .split(",")
      .map((s) =>
        s
          .trim()
          .replace(/^type\s+/, "")
          .split(/\s+as\s+/)[0]
          ?.trim(),
      )
      .filter((n) => n && /^[A-Za-z_$][\w$]*$/.test(n));
    if (names.length > 0) found.push({ specifier: m[2], names });
  }
  return found;
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const probes = [];
let id = 0;
for (const file of consumerFiles()) {
  for (const { specifier, names } of importsIn(readFileSync(file, "utf8"))) {
    if (!isLocal(specifier)) continue;
    id += 1;
    const probePath = join(OUT, `p${id}.ts`);
    // A BARE import, deliberately. The first version added `export type __N = [A, B]` to keep the
    // names used — which forced every name into TYPE position, so each exported FUNCTION reported
    // "refers to a value, but is being used as a type" and 83 of 101 findings were the probe's own
    // shape. An import alone still resolves the module and still reports a name the module does not
    // export, for types and values alike, which is the only question being asked.
    writeFileSync(probePath, `import { ${names.join(", ")} } from "${specifier}";\n`);
    probes.push({ probePath, file, specifier, names });
  }
}

// Explicit `paths` for every workspace package + subpath. pnpm isolates `node_modules` per package,
// so a probe at the repo root cannot resolve `@theokit/sdk` by normal lookup — and a probe that
// cannot resolve the MODULE reports every name as missing, which reads exactly like the defect being
// looked for. Mapping each declared subpath to its built `.d.ts` is what makes the answer about the
// SYMBOL rather than about where the probe happened to sit.
const paths = {};
for (const entry of readdirSync(PACKAGES)) {
  const manifestPath = join(PACKAGES, entry, "package.json");
  if (!existsSync(manifestPath)) continue;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.private === true || typeof manifest.name !== "string") continue;
  const dir = join(PACKAGES, entry);
  for (const [sub, cond] of Object.entries(manifest.exports ?? {})) {
    const types = cond?.import?.types ?? cond?.types;
    if (typeof types !== "string") continue;
    const specifier = sub === "." ? manifest.name : `${manifest.name}${sub.slice(1)}`;
    paths[specifier] = [join(dir, types)];
  }
}

const unbuilt = Object.entries(paths)
  .filter(([, [p]]) => !existsSync(p))
  .map(([s]) => s);
if (unbuilt.length > 0) {
  console.error(
    `[api-drift] ${unbuilt.length} declared entry point(s) are not built — run \`pnpm build\` first:`,
  );
  for (const s of unbuilt.slice(0, 8)) console.error(`      ${s}`);
  console.error("  Refusing to report: an unbuilt entry makes every name in it look missing.");
  process.exit(2);
}

writeFileSync(
  join(OUT, "tsconfig.json"),
  JSON.stringify(
    {
      compilerOptions: {
        noEmit: true,
        strict: false,
        skipLibCheck: true,
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        types: [],
        baseUrl: ".",
        paths,
      },
      include: ["*.ts"],
    },
    null,
    2,
  ),
);

let diagnostics = "";
try {
  execFileSync("npx", ["tsc", "-p", join(OUT, "tsconfig.json")], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
} catch (e) {
  diagnostics = `${e.stdout ?? ""}${e.stderr ?? ""}`;
}

const byProbe = new Map();
for (const line of diagnostics.split("\n")) {
  const m = /p(\d+)\.ts\(\d+,\d+\): error TS\d+: (.+)$/.exec(line.trim());
  if (m === null) continue;
  const n = Number(m[1]);
  if (!byProbe.has(n)) byProbe.set(n, []);
  byProbe.get(n).push(m[2]);
}

const findings = [];
for (const [n, msgs] of byProbe) {
  const probe = probes[n - 1];
  if (probe === undefined) continue;
  for (const msg of msgs) {
    findings.push({ file: relative(ROOT, probe.file), specifier: probe.specifier, msg });
  }
}

rmSync(OUT, { recursive: true, force: true });

/**
 * A scaffold template must not pin a NON-SDK dependency to `{{sdkVersion}}`.
 *
 * Measured 2026-08-20: `telegram-bot` pinned `@theokit/gateway` and
 * `@theokit/gateway-telegram` to `^{{sdkVersion}}`, which the scaffolder substitutes with the SDK's
 * own version — 4.53.1, against published gateway versions 0.5.1 and 0.1.2. A project scaffolded by
 * `theokit init --template telegram-bot` could not `pnpm install` at all: it failed before any code
 * ran, which is a worse first impression than code that fails to compile.
 *
 * Checked structurally rather than against the registry, so the gate needs no network: the defect is
 * "this placeholder means the SDK's version and was applied to something that is not the SDK".
 */
/** Every `<pkg>/templates/<name>` directory that carries a manifest. */
function templateManifests() {
  const out = [];
  for (const pkg of ["cli", "sdk"]) {
    const root = join(PACKAGES, pkg, "templates");
    if (!existsSync(root)) continue;
    for (const name of readdirSync(root)) {
      const manifest = join(root, name, "package.json");
      if (existsSync(manifest)) out.push({ label: `${pkg}/templates/${name}`, manifest });
    }
  }
  return out;
}

function templateVersionPins() {
  const bad = [];
  for (const { label, manifest } of templateManifests()) {
    const d = JSON.parse(readFileSync(manifest, "utf8"));
    const deps = { ...(d.dependencies ?? {}), ...(d.devDependencies ?? {}) };
    for (const [dep, range] of Object.entries(deps)) {
      if (dep !== "@theokit/sdk" && String(range).includes("{{sdkVersion}}")) {
        bad.push({ template: label, dep, range });
      }
    }
  }
  return bad;
}

const pinned = templateVersionPins();

if (findings.length === 0 && pinned.length === 0) {
  console.log(
    `[api-drift] ${probes.length} import(s) checked across the consumer-facing surface — every name ` +
      "resolves, and no template pins a non-SDK dependency to the SDK's version.",
  );
  process.exit(0);
}

if (pinned.length > 0) {
  console.log(`[api-drift] ${pinned.length} template dependency pin(s) that cannot install:\n`);
  for (const p of pinned) {
    console.log(
      `  ${p.template}\n      ${p.dep} pinned to "${p.range}" — {{sdkVersion}} substitutes the SDK's own version`,
    );
  }
  console.log("");
}

if (findings.length > 0) {
  const byFile = new Map();
  for (const f of findings) {
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file).push(f);
  }
  console.log(
    `[api-drift] ${findings.length} finding(s) in ${byFile.size} file(s), from ${probes.length} import(s) checked:\n`,
  );
  for (const [file, list] of [...byFile].sort()) {
    console.log(`  ${file}`);
    for (const f of list) console.log(`      ${f.specifier}  ::  ${f.msg}`);
  }
}

process.exit(1);
