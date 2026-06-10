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
import { join, relative as relativePath } from "node:path";
import type { CustomTool } from "@theokit/sdk";

import { defineTool } from "@theokit/sdk";
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
    }) as any,
    handler: async ({ query, path }) => {
      const scope = resolveSearchScope(path, projectRoot);
      if ("error" in scope) return scope.error;
      const state: SearchState = {
        matches: [],
        totalMatches: 0,
        truncated: false,
        query,
        maxMatches,
        maxFileSize,
        projectRoot,
      };
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

interface SearchState {
  matches: Match[];
  totalMatches: number;
  truncated: boolean;
  query: string;
  maxMatches: number;
  maxFileSize: number;
  projectRoot: string;
}

function resolveSearchScope(
  path: string | undefined,
  projectRoot: string,
): { scopeAbs: string } | { error: string } {
  const scopeRel = path === undefined || path === "" || path === "." ? "." : path;
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
    if (!line.includes(state.query)) continue;
    if (!recordMatch(state, relPath, i + 1, line)) return;
  }
}
