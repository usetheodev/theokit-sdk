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

import { readdir, readFile } from "node:fs/promises";
import { join, relative as relativePath } from "node:path";
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

const DEFAULT_MAX_MATCHES = 100;
const DEFAULT_MAX_FILE_SIZE = 1024 * 1024; // 1 MB
const BINARY_PROBE_BYTES = 8 * 1024;
const PREVIEW_MAX = 200;

export interface CreateSearchTextToolOptions {
  projectRoot: string;
  /** Cap on total matches returned. Default 100. */
  maxMatches?: number;
  /** Skip files larger than this (bytes). Default 1 MB. */
  maxFileSize?: number;
}

interface Match {
  file: string;
  line: number;
  preview: string;
}

export function createSearchTextTool(opts: CreateSearchTextToolOptions): CustomTool {
  const {
    projectRoot,
    maxMatches = DEFAULT_MAX_MATCHES,
    maxFileSize = DEFAULT_MAX_FILE_SIZE,
  } = opts;

  return defineTool({
    name: "search_text",
    description:
      `Search the project tree for a literal text query. Skips sensitive ` +
      `dirs (.env/.git/node_modules/.theo), binary files, and files over ` +
      `1 MB. Returns up to ${String(maxMatches)} matches as { file, line, preview }. ` +
      `Use 'path' to scope the search to a subdirectory.`,
    inputSchema: z.object({
      query: z.string().min(1).describe("Literal text to search for. Case-sensitive."),
      path: z
        .string()
        .optional()
        .describe("Optional project-relative directory to scope the search."),
    }),
    handler: async ({ query, path }) => {
      // Resolve scope
      const scopeRel = path === undefined || path === "" || path === "." ? "." : path;
      let scopeAbs: string;
      try {
        scopeAbs = scopeRel === "." ? projectRoot : safePathJoin(projectRoot, scopeRel);
        assertNoSymlinkEscape(scopeAbs, projectRoot);
      } catch (err) {
        if (err instanceof PathTraversalError || err instanceof ForbiddenPathError) {
          return JSON.stringify({ ok: false, error: "path_traversal", path });
        }
        throw err;
      }

      const matches: Match[] = [];
      let totalMatches = 0;
      let truncated = false;

      async function walk(absDir: string): Promise<void> {
        if (truncated) return;
        let entries;
        try {
          entries = await readdir(absDir, { withFileTypes: true });
        } catch {
          return; // ENOENT / EACCES — skip
        }
        for (const entry of entries) {
          if (truncated) return;
          const entryAbs = join(absDir, entry.name);
          const entryRel = relativePath(projectRoot, entryAbs);
          // Skip forbidden segments
          if (isForbiddenPath(entryRel)) continue;
          if (entry.isDirectory()) {
            await walk(entryAbs);
            continue;
          }
          if (!entry.isFile()) continue;
          await scanFile(entryAbs, entryRel);
        }
      }

      async function scanFile(absPath: string, relPath: string): Promise<void> {
        // Size + binary guard
        let buffer: Buffer;
        try {
          buffer = await readFile(absPath);
        } catch {
          return;
        }
        if (buffer.length > maxFileSize) return;
        const probeEnd = Math.min(buffer.length, BINARY_PROBE_BYTES);
        for (let i = 0; i < probeEnd; i += 1) {
          if (buffer[i] === 0) return; // binary
        }
        const text = buffer.toString("utf-8");
        const lines = text.split("\n");
        for (let i = 0; i < lines.length; i += 1) {
          const line = lines[i]!;
          if (line.includes(query)) {
            totalMatches += 1;
            if (matches.length < maxMatches) {
              matches.push({
                file: relPath,
                line: i + 1,
                preview: line.length > PREVIEW_MAX ? line.slice(0, PREVIEW_MAX) + "…" : line,
              });
            } else {
              truncated = true;
              return;
            }
          }
        }
      }

      await walk(scopeAbs);

      return JSON.stringify({
        ok: true,
        matches,
        truncated,
        totalMatches,
      });
    },
  });
}
