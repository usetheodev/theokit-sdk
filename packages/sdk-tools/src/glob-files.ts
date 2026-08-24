/**
 * `glob_files` — built-in tool for coding agents.
 *
 * Lists project files matching a glob pattern. Excludes node_modules,
 * .git, and dist by default. Returns relative paths.
 *
 * Return shape (always a JSON string):
 *   - `{ ok: true, files: string[], count }` (an empty match is `ok: true` with `files: []`)
 *   - `{ ok: false, error: 'path_traversal' }`
 */

import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
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
  PathTraversalError,
  safePathJoin,
} from "./internal/path-guard.js";

/** Directories excluded from traversal by default. */
const DEFAULT_EXCLUDES = new Set(["node_modules", ".git", "dist", ".theo"]);

/**
 * Depth cap for the BACKEND walk only. The local `readdir(withFileTypes)` walk skips symlinks (a
 * symlink entry is neither `isDirectory()` nor `isFile()`), so it can never loop. The backend walk
 * decides type via `stat`, which follows symlinks, so an in-boundary symlink cycle (e.g. `a → .`)
 * would recurse until the path exceeds PATH_MAX. This bound stops that pathological case; real project
 * trees never approach it.
 */
const MAX_BACKEND_WALK_DEPTH = 64;

export interface CreateGlobToolOptions {
  /** M76 — name exposed to the model. Omitted => today's literal (additive). The name is a contract:
   *  the approval key, what the model sees and what telemetry records. */
  name?: string;
  /** M76 — description exposed to the model. Omitted => today's literal (additive). */
  description?: string;
  /** Absolute path to the project root. */
  projectRoot: string;
  /** Optional injected filesystem (`@theokit/sdk/filesystem`) — when provided, the walk reads through the
   *  backend (Local/remote), so the tool is surface-agnostic; omitted ⇒ the local `readdir` (unchanged). */
  filesystem?: FilesystemProvider;
}

/**
 * Build the `glob_files` tool: find files by the shape of their name. Use it when you know what the
 * file is called, `search_text` when you know what is inside it, `read_file` when you know the path.
 *
 * The pattern is matched against paths relative to `cwd`, while the paths returned are relative to
 * `projectRoot` — `{ pattern: "*.ts", cwd: "src" }` matches `index.ts` and returns `src/index.ts`.
 * Only `*`, `**` and `?` are wildcards; braces and character classes are escaped to literals, so
 * `*.{ts,js}` matches a file actually named that. Matching is anchored at both ends, which is why a
 * bare `*.ts` sees only the top level of the search root and a leading `**` is usually what is meant.
 *
 * `node_modules`, `.git`, `dist` and `.theo` are skipped by name at any depth and cannot be
 * re-enabled. Nothing else is filtered: this returns names, so a `.env` file is listed even though
 * `read_file` would refuse to open it. An unreadable directory is skipped without a word rather than
 * failing the call, so a permission problem looks like an empty directory. The only refusal is
 * `path_traversal` on `cwd`; a pattern matching nothing is `{ ok: true, files: [] }`.
 */
export function createGlobTool(opts: CreateGlobToolOptions): CustomTool {
  const { projectRoot, filesystem } = opts;

  return Tool.create({
    name: opts.name ?? "glob_files",
    description:
      opts.description ??
      "Find files by glob pattern across the project — fast at any repo size. Use glob_files when " +
        "you know the filename SHAPE; use search_text when you know the file CONTENT; use read_file " +
        "when you know the exact path. The pattern supports * and ** wildcards (e.g. '**/*.ts', " +
        "'src/**/*.json'); node_modules/.git/dist/.theo are excluded and results are relative paths. " +
        "Returns { ok, files } or { ok: false, error }.",
    inputSchema: z.object({
      pattern: z.string().min(1).describe("Glob pattern (e.g. '**/*.ts', 'src/**/*.json')."),
      cwd: z.string().optional().describe("Project-relative subdirectory to search from."),
    }),
    handler: async ({ pattern, cwd }, ctx) => {
      // Path-scope guard (pure security) applies to both fs paths.
      const scopeErr = globScopeError(cwd, projectRoot);
      if (scopeErr !== null) return scopeErr;
      const regex = globToRegex(pattern);

      // Injected filesystem (surface-agnostic): walk via the backend in PROJECT-RELATIVE path space
      // (like read_file); absent ⇒ the local `readdir` walk (byte-identical to before).
      if (filesystem !== undefined) {
        const backend = await resolveFilesystem(filesystem, ctx ?? {});
        const searchRel = cwd ?? "";
        const found: string[] = [];
        await walkDirBackend(backend, searchRel, searchRel, regex, found, 0);
        return JSON.stringify({ ok: true, files: found.sort(), count: found.length });
      }

      const searchRoot = cwd ? safePathJoin(projectRoot, cwd) : projectRoot;
      const files: string[] = [];
      await walkDir(searchRoot, searchRoot, regex, files);
      const relativePaths = files.map((f) => relative(projectRoot, f)).sort();
      return JSON.stringify({ ok: true, files: relativePaths, count: relativePaths.length });
    },
  });
}

/** Shared cwd path-scope guard — returns an error JSON string, or null when the scope is safe. */
function globScopeError(cwd: string | undefined, projectRoot: string): string | null {
  if (!cwd) return null;
  try {
    assertNoSymlinkEscape(safePathJoin(projectRoot, cwd), projectRoot);
    return null;
  } catch (err) {
    if (err instanceof PathTraversalError || err instanceof ForbiddenPathError) {
      return JSON.stringify({ ok: false, error: "path_traversal", path: cwd });
    }
    throw err;
  }
}

async function walkDir(
  base: string,
  dir: string,
  pattern: RegExp,
  results: string[],
): Promise<void> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // directory doesn't exist or unreadable
  }

  for (const entry of entries) {
    if (DEFAULT_EXCLUDES.has(entry.name)) continue;

    const fullPath = join(dir, entry.name);
    const relPath = relative(base, fullPath);

    if (entry.isDirectory()) {
      await walkDir(base, fullPath, pattern, results);
    } else if (entry.isFile() && pattern.test(relPath)) {
      results.push(fullPath);
    }
  }
}

/** Backend walk (surface-agnostic): mirrors {@link walkDir} in PROJECT-RELATIVE path space via
 *  `backend.list` + `backend.stat` (the FilesystemBackend interface returns untyped names, so a
 *  `stat` per entry supplies isDirectory/isFile). Collects project-relative paths. */
async function walkDirBackend(
  backend: FilesystemBackend,
  base: string,
  dir: string,
  pattern: RegExp,
  results: string[],
  depth: number,
): Promise<void> {
  if (depth > MAX_BACKEND_WALK_DEPTH) return; // symlink-cycle guard (see MAX_BACKEND_WALK_DEPTH)
  let names: string[];
  try {
    names = await backend.list(dir);
  } catch {
    return; // directory doesn't exist or unreadable
  }
  for (const name of names) {
    await walkBackendEntry(backend, base, dir, name, pattern, results, depth);
  }
}

/** Handle one backend directory entry: stat it, recurse on dirs, collect matching files. */
async function walkBackendEntry(
  backend: FilesystemBackend,
  base: string,
  dir: string,
  name: string,
  pattern: RegExp,
  results: string[],
  depth: number,
): Promise<void> {
  if (DEFAULT_EXCLUDES.has(name)) return;
  const fullRel = dir === "" ? name : `${dir}/${name}`;
  const relPath = base === "" ? fullRel : relative(base, fullRel);
  let st: { isDirectory: boolean; isFile: boolean };
  try {
    st = await backend.stat(fullRel);
  } catch {
    return;
  }
  if (st.isDirectory) {
    await walkDirBackend(backend, base, fullRel, pattern, results, depth + 1);
  } else if (st.isFile && pattern.test(relPath)) {
    results.push(fullRel);
  }
}

/** Convert a simple glob pattern to a RegExp. Supports * and ** wildcards. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: parser logic
function globToRegex(pattern: string): RegExp {
  let regexStr = "";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i]!;
    if (ch === "*" && pattern[i + 1] === "*") {
      // ** matches any path segment(s)
      regexStr += ".*";
      i += 2;
      if (pattern[i] === "/") i++; // skip trailing slash after **
    } else if (ch === "*") {
      // * matches anything except /
      regexStr += "[^/]*";
      i++;
    } else if (ch === "?") {
      regexStr += "[^/]";
      i++;
      // biome-ignore lint/suspicious/noTemplateCurlyInString: regex escape chars, not template
    } else if (".+^${}()|[]\\".includes(ch)) {
      regexStr += `\\${ch}`;
      i++;
    } else {
      regexStr += ch;
      i++;
    }
  }
  return new RegExp(`^${regexStr}$`);
}
