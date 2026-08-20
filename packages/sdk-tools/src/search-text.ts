/**
 * `search_text` — built-in tool for coding agents.
 *
 * Literal text search across the project tree (recursive). Sensible
 * defaults:
 *
 *   - Skips forbidden directories (`.env`, `.git/`, `node_modules/`,
 *     `.theo/`) so the agent never wastes context on dependency soup
 *     or VCS internals.
 *   - Skips files larger than `maxFileSize` (default 1 MB) and binary
 *     files (null-byte detection on first 8 KB) so a megabyte of
 *     minified JS never blows up the result.
 *   - Caps total matches at `maxMatches` (default 100) — the agent
 *     should refine the query if it gets close to the cap.
 *
 * Result shape (always a JSON string):
 *   - `{ ok: true, matches: Array<{ file, line, preview }>, truncated, totalMatches }`
 *   - `{ ok: false, error: 'path_traversal' | 'forbidden_path' | 'not_found' }`
 *
 * Implementation note: this is a plain JS recursive walk. For very
 * large repos a future iteration can shell out to `rg` (ripgrep) when
 * present, but the JS path stays as the dependency-free fallback.
 */

import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { isAbsolute, join, relative as relativePath } from "node:path";
import type { CustomTool } from "@theokit/sdk";
import { Tool } from "@theokit/sdk";
import {
  type FilesystemBackend,
  type FilesystemProvider,
  resolveFilesystem,
} from "@theokit/sdk/filesystem";
import { z } from "zod";
import {
  assertNoSymlinkEscape,
  ForbiddenPathError,
  isForbiddenPath,
  PathTraversalError,
  safePathJoin,
} from "./internal/path-guard.js";

const DEFAULT_MAX_MATCHES = 100;
const DEFAULT_MAX_FILE_SIZE = 1024 * 1024; // 1 MB
const BINARY_PROBE_BYTES = 8 * 1024;
const PREVIEW_MAX = 200;
/**
 * Depth cap for the BACKEND walk only. The local `readdir(withFileTypes)` walk skips symlinks and can
 * never loop; the backend walk decides type via `stat` (which follows symlinks), so an in-boundary
 * symlink cycle would recurse until PATH_MAX. This bound stops that pathological case; real trees never
 * approach it.
 */
const MAX_BACKEND_WALK_DEPTH = 64;

export interface CreateSearchTextToolOptions {
  /**
   * M76 — the name exposed to the model. Omitted ⇒ today's literal (additive).
   *
   * It exists because, in Codex, the name is BORN in the tool definition and is the approval decision
   * key — three consumers (model, approval, telemetry) of a string decided in one place. Renaming
   * after construction changes the identity of something already published to the model. `withName`
   * remains for the genuinely dynamic case.
   */
  name?: string;
  /** M76 — description exposed to the model. Omitted => today's literal (additive). */
  description?: string;
  projectRoot: string;
  /** Cap on total matches returned. Default 100. */
  maxMatches?: number;
  /** Skip files larger than this (bytes). Default 1 MB. */
  maxFileSize?: number;
  /** Optional injected filesystem (`@theokit/sdk/filesystem`) — when provided, the recursive walk reads
   *  through the backend (surface-agnostic); omitted ⇒ the local `readdir`/`readFile` walk (unchanged). */
  filesystem?: FilesystemProvider;
  /** M17 — treat `query` as a JavaScript RegExp instead of a literal substring (grep semantics). An
   *  invalid pattern returns `{ ok: false, error: 'invalid_regex' }`. Default `false` ⇒ literal (unchanged). */
  regex?: boolean;
  /** M17 — opt-in "reads-anywhere": honor an ABSOLUTE `path` scope outside `projectRoot` (Codex read-only
   *  sandbox). Forbidden dirs are still skipped. Default `false` ⇒ absolute scope rejected (unchanged). */
  allowAbsolute?: boolean;
}

interface Match {
  file: string;
  line: number;
  preview: string;
}

/**
 * Build the `search_text` tool: scan file CONTENTS across the tree. Use it when you know what the
 * code says, and `glob_files` when you know what the file is called.
 *
 * `regex` is fixed at construction, not chosen per call — it changes both the input schema and the
 * description the model sees, so one instance is either literal-substring or regex, never both.
 * Literal matching is case-sensitive and there is no case-insensitive mode. In regex mode the pattern
 * is compiled with no flags (an inline `(?i)` is a syntax error, not a modifier) and an invalid
 * pattern returns `{ ok: false, error: "invalid_regex" }` before any file is opened.
 *
 * Matches carry `{ file, line, preview }` with `line` 1-based and `preview` cut at 200 characters.
 * The walk stops at the first match past `maxMatches` (default 100), so on a truncated run
 * `totalMatches` is `maxMatches + 1` — it counts what was scanned, not how many matches exist. Files
 * over `maxFileSize` (default 1 MB), files with a null byte in their first 8 KB, and anything
 * unreadable are skipped in silence.
 *
 * `allowAbsolute` honours an absolute `path` scope. Be aware that the sensitive-path filter applied
 * during the walk inspects only the first segment of each entry's path relative to `projectRoot`,
 * plus its basename. Under an absolute scope every entry's relative path begins with `..`, so a
 * nested `.env` is neither skipped nor refused and its matching lines are returned.
 * {@link createReadFileTool} and {@link createListDirTool} carry an any-depth guard for exactly this
 * case; this tool does not.
 */
export function createSearchTextTool(opts: CreateSearchTextToolOptions): CustomTool {
  const {
    projectRoot,
    maxMatches = DEFAULT_MAX_MATCHES,
    maxFileSize = DEFAULT_MAX_FILE_SIZE,
    filesystem,
    regex = false,
    allowAbsolute = false,
  } = opts;
  const queryKind = regex ? "a JavaScript REGULAR EXPRESSION" : "LITERAL, CASE-SENSITIVE text";
  const queryMatch = regex ? "matched as a regex" : "matched as a substring, not a regex";

  return Tool.create({
    name: opts.name ?? "search_text",
    description:
      opts.description ??
      `Search file CONTENTS for ${queryKind} across the project tree (the query is ${queryMatch}). ` +
        `Use search_text when you know the content; use glob_files when you know the filename shape; use ` +
        `read_file when you know the exact path. Skips sensitive dirs (.env/.git/node_modules/.theo), ` +
        `binary files, and files over 1 MB; 'path' scopes the search to a subdirectory. Returns up to ` +
        `${String(maxMatches)} matches as { file, line, preview } — cite locations to the user as ` +
        `file:line. Returns { ok, matches } or { ok: false, error }.`,
    inputSchema: z.object({
      query: regex
        ? z.string().min(1).describe("A JavaScript regular expression, e.g. 'function\\\\s+main'.")
        : z.string().min(1).describe("Literal text to search for. Case-sensitive."),
      path: z
        .string()
        .optional()
        .describe(
          "Optional directory to scope the search (project-relative; absolute when allowed).",
        ),
    }),
    handler: async ({ query, path }, ctx) => {
      // M17 — build the line matcher once (regex or literal). An invalid regex fails clear before walking.
      const built = buildMatcher(query, regex);
      if ("error" in built) return built.error;
      const matcher = built.matcher;
      const state: SearchState = {
        matches: [],
        totalMatches: 0,
        truncated: false,
        matcher,
        maxMatches,
        maxFileSize,
        projectRoot,
      };

      // Injected filesystem (surface-agnostic) ⇒ walk via the backend in project-relative path space;
      // absent ⇒ the local `readdir`/`readFile` walk (byte-identical to before).
      if (filesystem !== undefined) {
        const scopeRel = resolveScopeRel(path, projectRoot, allowAbsolute);
        if ("error" in scopeRel) return scopeRel.error;
        const backend = await resolveFilesystem(filesystem, ctx ?? {});
        await walkBackend(backend, scopeRel.rel, state, 0);
        return JSON.stringify({
          ok: true,
          matches: state.matches,
          truncated: state.truncated,
          totalMatches: state.totalMatches,
        });
      }

      const scope = resolveSearchScope(path, projectRoot, allowAbsolute);
      if ("error" in scope) return scope.error;
      await walk(scope.scopeAbs, state);
      return JSON.stringify({
        ok: true,
        matches: state.matches,
        truncated: state.truncated,
        totalMatches: state.totalMatches,
      });
    },
  });
}

/** Build the per-line predicate: a compiled RegExp (M17 grep mode) or a literal substring test. */
function buildMatcher(
  query: string,
  regex: boolean,
): { matcher: (line: string) => boolean } | { error: string } {
  if (!regex) return { matcher: (line) => line.includes(query) };
  try {
    const re = new RegExp(query);
    return { matcher: (line) => re.test(line) };
  } catch {
    return { error: JSON.stringify({ ok: false, error: "invalid_regex", query }) };
  }
}

interface SearchState {
  matches: Match[];
  totalMatches: number;
  truncated: boolean;
  /** Per-line predicate — literal substring or compiled regex (M17). */
  matcher: (line: string) => boolean;
  maxMatches: number;
  maxFileSize: number;
  projectRoot: string;
}

function resolveSearchScope(
  path: string | undefined,
  projectRoot: string,
  allowAbsolute: boolean,
): { scopeAbs: string } | { error: string } {
  const scopeRel = path === undefined || path === "" || path === "." ? "." : path;
  // M17 — reads-anywhere: honor an absolute scope (Codex read-only sandbox); forbidden dirs still skipped.
  if (allowAbsolute && isAbsolute(scopeRel)) {
    return { scopeAbs: scopeRel };
  }
  try {
    const scopeAbs = scopeRel === "." ? projectRoot : safePathJoin(projectRoot, scopeRel);
    assertNoSymlinkEscape(scopeAbs, projectRoot);
    return { scopeAbs };
  } catch (err) {
    if (err instanceof PathTraversalError || err instanceof ForbiddenPathError) {
      return { error: JSON.stringify({ ok: false, error: "path_traversal", path }) };
    }
    throw err;
  }
}

async function handleEntry(entry: Dirent, absDir: string, state: SearchState): Promise<void> {
  const entryAbs = join(absDir, entry.name);
  const entryRel = relativePath(state.projectRoot, entryAbs);
  if (isForbiddenPath(entryRel)) return;
  if (entry.isDirectory()) {
    await walk(entryAbs, state);
    return;
  }
  if (entry.isFile()) await scanFile(entryAbs, entryRel, state);
}

async function walk(absDir: string, state: SearchState): Promise<void> {
  if (state.truncated) return;
  const entries = await readEntriesQuiet(absDir);
  if (entries === null) return;
  for (const entry of entries) {
    if (state.truncated) return;
    await handleEntry(entry, absDir, state);
  }
}

async function readEntriesQuiet(absDir: string): Promise<Dirent[] | null> {
  try {
    return await readdir(absDir, { withFileTypes: true });
  } catch {
    return null;
  }
}

async function readBufferQuiet(absPath: string): Promise<Buffer | null> {
  try {
    return await readFile(absPath);
  } catch {
    return null;
  }
}

function isBinaryBuffer(buffer: Buffer): boolean {
  const probeEnd = Math.min(buffer.length, BINARY_PROBE_BYTES);
  for (let i = 0; i < probeEnd; i += 1) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

function recordMatch(state: SearchState, file: string, line: number, lineText: string): boolean {
  state.totalMatches += 1;
  if (state.matches.length < state.maxMatches) {
    state.matches.push({
      file,
      line,
      preview: lineText.length > PREVIEW_MAX ? `${lineText.slice(0, PREVIEW_MAX)}…` : lineText,
    });
    return true;
  }
  state.truncated = true;
  return false;
}

async function scanFile(absPath: string, relPath: string, state: SearchState): Promise<void> {
  const buffer = await readBufferQuiet(absPath);
  if (buffer === null || buffer.length > state.maxFileSize) return;
  if (isBinaryBuffer(buffer)) return;
  const lines = buffer.toString("utf-8").split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (!state.matcher(line)) continue;
    if (!recordMatch(state, relPath, i + 1, line)) return;
  }
}

// --- Surface-agnostic backend walk (mirrors the local walk in PROJECT-RELATIVE path space) ---

/** Resolve the scope to a project-relative dir (`""` = root) with the same security guard as the local
 *  path — a traversal/forbidden scope is rejected identically. */
function resolveScopeRel(
  path: string | undefined,
  projectRoot: string,
  allowAbsolute: boolean,
): { rel: string } | { error: string } {
  const scopeRel = path === undefined || path === "" || path === "." ? "" : path;
  if (scopeRel === "") return { rel: "" };
  // M17 — reads-anywhere: pass an absolute scope through to the backend (it owns its own boundary).
  if (allowAbsolute && isAbsolute(scopeRel)) return { rel: scopeRel };
  try {
    assertNoSymlinkEscape(safePathJoin(projectRoot, scopeRel), projectRoot);
    return { rel: scopeRel };
  } catch (err) {
    if (err instanceof PathTraversalError || err instanceof ForbiddenPathError) {
      return { error: JSON.stringify({ ok: false, error: "path_traversal", path }) };
    }
    throw err;
  }
}

async function walkBackend(
  backend: FilesystemBackend,
  dirRel: string,
  state: SearchState,
  depth: number,
): Promise<void> {
  if (state.truncated) return;
  if (depth > MAX_BACKEND_WALK_DEPTH) return; // symlink-cycle guard (see MAX_BACKEND_WALK_DEPTH)
  let names: string[];
  try {
    names = await backend.list(dirRel);
  } catch {
    return;
  }
  for (const name of names) {
    if (state.truncated) return;
    await handleBackendEntry(backend, dirRel, name, state, depth);
  }
}

/** Handle one backend directory entry: skip forbidden, stat, recurse on dirs, scan files. */
async function handleBackendEntry(
  backend: FilesystemBackend,
  dirRel: string,
  name: string,
  state: SearchState,
  depth: number,
): Promise<void> {
  const entryRel = dirRel === "" ? name : `${dirRel}/${name}`;
  if (isForbiddenPath(entryRel)) return;
  let st: { isDirectory: boolean; isFile: boolean; size: number };
  try {
    st = await backend.stat(entryRel);
  } catch {
    return;
  }
  if (st.isDirectory) {
    await walkBackend(backend, entryRel, state, depth + 1);
  } else if (st.isFile) {
    await scanFileBackend(backend, entryRel, st.size, state);
  }
}

async function scanFileBackend(
  backend: FilesystemBackend,
  relPath: string,
  size: number,
  state: SearchState,
): Promise<void> {
  if (size > state.maxFileSize) return;
  let content: string;
  try {
    content = await backend.readFile(relPath);
  } catch {
    return;
  }
  // Null-byte ⇒ binary; skip (parity with the local isBinaryBuffer probe, string-side).
  if (content.slice(0, BINARY_PROBE_BYTES).includes("\u0000")) return;
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (!state.matcher(line)) continue;
    if (!recordMatch(state, relPath, i + 1, line)) return;
  }
}
