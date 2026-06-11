/**
 * `glob_files` — built-in tool for coding agents.
 *
 * Lists project files matching a glob pattern. Excludes node_modules,
 * .git, and dist by default. Returns relative paths.
 *
 * Return shape (always a JSON string):
 *   - `{ ok: true, files: string[] }`
 *   - `{ ok: false, error: 'path_traversal' | 'no_matches' }`
 */

import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import type { CustomTool } from "@theokit/sdk";

import { defineTool } from "@theokit/sdk";
import { z } from "zod";
import {
  assertNoSymlinkEscape,
  ForbiddenPathError,
  PathTraversalError,
  safePathJoin,
} from "./internal/path-guard.js";

/** Directories excluded from traversal by default. */
const DEFAULT_EXCLUDES = new Set(["node_modules", ".git", "dist", ".theo"]);

export interface CreateGlobToolOptions {
  /** Absolute path to the project root. */
  projectRoot: string;
}

export function createGlobTool(opts: CreateGlobToolOptions): CustomTool {
  const { projectRoot } = opts;

  return defineTool({
    name: "glob_files",
    description:
      "List project files matching a glob-like pattern. Excludes " +
      "node_modules, .git, dist, .theo by default. Returns relative " +
      "paths. Pattern supports * and ** wildcards. Returns { ok, files } " +
      "or { ok: false, error }.",
    inputSchema: z.object({
      pattern: z.string().min(1).describe("Glob pattern (e.g. '**/*.ts', 'src/**/*.json')."),
      cwd: z.string().optional().describe("Project-relative subdirectory to search from."),
    }),
    handler: async ({ pattern, cwd }) => {
      let searchRoot = projectRoot;

      if (cwd) {
        try {
          searchRoot = safePathJoin(projectRoot, cwd);
          assertNoSymlinkEscape(searchRoot, projectRoot);
        } catch (err) {
          if (err instanceof PathTraversalError || err instanceof ForbiddenPathError) {
            return JSON.stringify({ ok: false, error: "path_traversal", path: cwd });
          }
          throw err;
        }
      }

      const regex = globToRegex(pattern);
      const files: string[] = [];

      await walkDir(searchRoot, searchRoot, regex, files);

      const relativePaths = files.map((f) => relative(projectRoot, f)).sort();
      return JSON.stringify({ ok: true, files: relativePaths, count: relativePaths.length });
    },
  });
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
