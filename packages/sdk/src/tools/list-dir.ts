/**
 * `list_dir` — built-in tool for coding agents.
 *
 * Returns the direct entries of a project-relative directory. Hardened
 * against the same four bug families as `read_file` plus the
 * **EC-6 unbounded output** failure mode: in a project with 10k files,
 * a naive listing returns a 5 MB JSON payload that freezes the browser
 * and (more importantly) blows past the LLM context window.
 *
 * Defaults:
 *   - `max = 500` entries (override via factory option `{ max }`)
 *   - Result includes `{ truncated: boolean, totalCount: number }` so the
 *     agent can decide whether to drill deeper or call `search_text` instead
 *
 * Result shape (always a JSON string):
 *   - `{ ok: true, entries: Array<{ name, type }>, truncated, totalCount }`
 *   - `{ ok: false, error: 'path_traversal' | 'forbidden_path' | 'not_found' }`
 */

import { readdir } from "node:fs/promises";
import { z } from "zod";

import { defineTool } from "../define-tool.js";
import {
  assertNoSymlinkEscape,
  ForbiddenPathError,
  isForbiddenPath,
  PathTraversalError,
  safePathJoin,
} from "../internal/security/path-guard.js";
import type { CustomTool } from "../types/agent.js";

const DEFAULT_MAX_ENTRIES = 500;

export interface CreateListDirToolOptions {
  /** Absolute path to the project root. Every listing is gated against this boundary. */
  projectRoot: string;
  /** Maximum number of entries returned per call. Default 500. */
  max?: number;
}

export function createListDirTool(opts: CreateListDirToolOptions): CustomTool {
  const { projectRoot, max = DEFAULT_MAX_ENTRIES } = opts;

  return defineTool({
    name: "list_dir",
    description:
      `Return the direct entries of a project-relative directory. ` +
      `Refuses paths outside the project root or in the sensitive-file ` +
      `blocklist (.env, .git/, node_modules/, .theo/, lock files). Caps ` +
      `at ${String(max)} entries by default; result carries truncated + totalCount.`,
    inputSchema: z.object({
      path: z.string().min(1).describe("Project-relative directory path. Use '.' for root."),
    }),
    handler: async ({ path }) => {
      // Empty / dot path = project root
      const relative = path === "" || path === "." ? "." : path;

      // Sensitive-file gate — skip for "." which is always project root
      if (relative !== "." && isForbiddenPath(relative)) {
        return JSON.stringify({ ok: false, error: "forbidden_path", path });
      }

      // Boundary gate
      let absolutePath: string;
      try {
        absolutePath = relative === "." ? projectRoot : safePathJoin(projectRoot, relative);
        assertNoSymlinkEscape(absolutePath, projectRoot);
      } catch (err) {
        if (err instanceof PathTraversalError || err instanceof ForbiddenPathError) {
          return JSON.stringify({ ok: false, error: "path_traversal", path });
        }
        throw err;
      }

      // Read entries
      let dirents;
      try {
        dirents = await readdir(absolutePath, { withFileTypes: true });
      } catch (err) {
        const e = err as { code?: string };
        if (e.code === "ENOENT" || e.code === "ENOTDIR") {
          return JSON.stringify({ ok: false, error: "not_found", path });
        }
        throw err;
      }

      const totalCount = dirents.length;
      const truncated = totalCount > max;
      const entries = dirents.slice(0, max).map((d) => ({
        name: d.name,
        type: d.isDirectory() ? ("directory" as const) : ("file" as const),
      }));

      return JSON.stringify({ ok: true, entries, truncated, totalCount });
    },
  });
}
