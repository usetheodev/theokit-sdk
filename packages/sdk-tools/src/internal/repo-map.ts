/**
 * Repo-map / env-context builders for orienting an LLM coding agent (M3-3).
 *
 * `buildEnvContext(cwd)` renders a short `<env>` block (cwd, platform, node,
 * is-git, date, project docs, manifests). `buildRepoMap(cwd, opts)` renders a
 * char-bounded, depth-limited directory tree. Both are node:fs-only and NEVER
 * throw — a missing/unreadable path yields a best-effort partial string or an
 * `(unavailable)` marker (distinct from the M3-1/M3-2 guards, which throw).
 *
 * Design: blueprint m3-repo-map. Zero new dependencies. A best-effort
 * orientation aid, not a complete or secure listing (bounded + skips on error).
 */

import { type Dirent, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export interface RepoMapOptions {
  /** Max characters of tree output before truncation. Default 8000. */
  budget?: number;
  /** Directory/file names to skip (merged with the built-in ignore set). */
  ignore?: string[];
  /** Max directory depth to descend. Default 4. */
  maxDepth?: number;
}

const DEFAULT_BUDGET = 8000;
const DEFAULT_MAX_DEPTH = 4;
const PER_DIR_CAP = 200;
const TRUNCATED_MARKER = "… (truncated)";
const DOC_HEAD_CHARS = 200;
const DEFAULT_REPO_MAP_IGNORE = [
  "node_modules",
  ".git",
  "dist",
  ".theo",
  ".next",
  "build",
  "coverage",
  "target",
  "out",
];
const PROJECT_DOCS = ["AGENTS.md", "CLAUDE.md", "README.md"];
const MANIFESTS = ["package.json", "pyproject.toml", "Cargo.toml", "go.mod"];

function safeExists(p: string): boolean {
  try {
    return existsSync(p);
  } catch {
    return false;
  }
}

function safeReadHead(p: string, n: number): string {
  try {
    return readFileSync(p, "utf-8").slice(0, n).replace(/\s+/g, " ").trim();
  } catch {
    return "";
  }
}

/**
 * Options for {@link buildEnvContext}. Both fields exist to make the block deterministic under test:
 * `now` fixes the date line, `gitHeadPath` points the branch lookup at a fixture instead of
 * `<cwd>/.git/HEAD`. Neither changes what the block contains.
 */
export interface EnvContextOptions {
  /** Injectable clock for the date line (deterministic tests). Default `new Date()`. */
  now?: Date;
  /** Path to the git `HEAD` file. Default `<cwd>/.git/HEAD`. */
  gitHeadPath?: string;
}

/**
 * Read the current git branch from `HEAD` — a PURE file read (never a
 * `child_process` spawn, which could hang the request path or expose
 * arg-injection). Returns `undefined` for a detached HEAD, a missing file,
 * or any read error. Borrowed from theocode's `project-context.ts`.
 */
function gitBranch(headPath: string): string | undefined {
  try {
    const head = readFileSync(headPath, "utf-8").trim();
    const match = head.match(/^ref:\s*refs\/heads\/(.+)$/);
    return match ? match[1] : undefined;
  } catch {
    return undefined;
  }
}

/** Render a portable `<env>` orientation block. Never throws. */
export function buildEnvContext(cwd: string, opts: EnvContextOptions = {}): string {
  const lines = [
    "<env>",
    `  Working directory: ${cwd}`,
    `  Platform: ${process.platform} (${process.arch})`,
    `  Node: ${process.version}`,
    `  Is git repo: ${safeExists(join(cwd, ".git")) ? "yes" : "no"}`,
  ];
  const branch = gitBranch(opts.gitHeadPath ?? join(cwd, ".git", "HEAD"));
  if (branch) lines.push(`  Branch: ${branch}`);
  lines.push(`  Today's date: ${(opts.now ?? new Date()).toDateString()}`);
  const docs = PROJECT_DOCS.filter((d) => safeExists(join(cwd, d)));
  if (docs.length > 0) {
    lines.push(`  Project docs: ${docs.join(", ")}`);
    const head = safeReadHead(join(cwd, docs[0] as string), DOC_HEAD_CHARS);
    if (head) lines.push(`  ${docs[0]} (head): ${head}`);
  }
  const manifests = MANIFESTS.filter((m) => safeExists(join(cwd, m)));
  if (manifests.length > 0) lines.push(`  Manifests: ${manifests.join(", ")}`);
  lines.push("</env>");
  return lines.join("\n");
}

/** dirs-first, then alphabetical. Symlinks count as leaves (not followed). */
function compareEntries(a: Dirent, b: Dirent): number {
  const ad = a.isDirectory() ? 0 : 1;
  const bd = b.isDirectory() ? 0 : 1;
  return ad !== bd ? ad - bd : a.name.localeCompare(b.name);
}

function visibleEntries(dir: string, ignore: Set<string>): Dirent[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.filter((e) => !ignore.has(e.name) && !e.name.startsWith(".")).sort(compareEntries);
}

interface WalkCtx {
  ignore: Set<string>;
  maxDepth: number;
  budget: number;
  lines: string[];
  used: number;
  truncated: boolean;
}

/** Append a line if it fits the budget; flag truncation and return false otherwise. */
function pushLine(ctx: WalkCtx, line: string): boolean {
  if (ctx.used + line.length + 1 > ctx.budget) {
    ctx.truncated = true;
    return false;
  }
  ctx.lines.push(line);
  ctx.used += line.length + 1;
  return true;
}

/** Emit one entry (and recurse into a real sub-dir). Returns false when budget is hit. */
function emitEntry(ctx: WalkCtx, dir: string, e: Dirent, depth: number, indent: string): boolean {
  const isDir = e.isDirectory(); // symlink-to-dir → false → treated as a leaf, not followed
  if (!pushLine(ctx, `${indent}${isDir ? `${e.name}/` : e.name}`)) return false;
  if (isDir && depth + 1 < ctx.maxDepth) return walkDir(ctx, join(dir, e.name), depth + 1);
  return true;
}

function walkDir(ctx: WalkCtx, dir: string, depth: number): boolean {
  const entries = visibleEntries(dir, ctx.ignore);
  const shown = entries.slice(0, PER_DIR_CAP);
  const indent = "  ".repeat(depth);
  for (const e of shown) {
    if (!emitEntry(ctx, dir, e, depth, indent)) return false;
  }
  if (entries.length > shown.length) {
    return pushLine(ctx, `${indent}… (${entries.length - shown.length} more)`);
  }
  return true;
}

/** Render a char-bounded, depth-limited directory tree. Never throws. */
export function buildRepoMap(cwd: string, opts: RepoMapOptions = {}): string {
  try {
    if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
      return `(unavailable: ${cwd} is not a readable directory)`;
    }
  } catch {
    return `(unavailable: ${cwd})`;
  }

  const ctx: WalkCtx = {
    ignore: new Set([...DEFAULT_REPO_MAP_IGNORE, ...(opts.ignore ?? [])]),
    maxDepth: opts.maxDepth ?? DEFAULT_MAX_DEPTH,
    budget: opts.budget ?? DEFAULT_BUDGET,
    lines: [],
    used: 0,
    truncated: false,
  };
  walkDir(ctx, cwd, 0);
  return ctx.truncated ? `${ctx.lines.join("\n")}\n${TRUNCATED_MARKER}` : ctx.lines.join("\n");
}
