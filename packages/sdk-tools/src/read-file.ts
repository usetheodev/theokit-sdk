/**
 * `read_file` — built-in tool for coding agents.
 *
 * Reads a project-relative file as UTF-8 and returns its contents.
 * Hardened against the four bug families a coding agent normally hits:
 *
 *   1. **Path traversal** — `safePathJoin` rejects literal `..`,
 *      normalised escape, absolute segments, null-byte injection.
 *   2. **Symlink escape** — `assertNoSymlinkEscape` follows the full
 *      chain (and any intermediate symlinks; defence-in-depth fix v1.x).
 *   3. **Sensitive files** — `isForbiddenPath` blocks `.env*` (except
 *      `.env.example`), `.git/`, `node_modules/`, `.theo/`, lock files.
 *   4. **Binary files** — null-byte check on the first 8 KB. PNG/JPEG/
 *      compiled binaries return a structured `binary_file` error
 *      instead of garbled UTF-8 (EC-5 from the TheoKit Studio review).
 *
 * Return shape (always a JSON string the LLM consumes):
 *   - `{ ok: true, content: string }` on success
 *   - `{ ok: false, error: 'path_traversal' | 'forbidden_path' |
 *        'binary_file' | 'not_found' | 'too_large' }` on refusal
 *
 * The handler intentionally never throws on a "user mistake"
 * (traversal / forbidden / not found). Throwing reserved for SDK-side
 * mistakes that should crash the agent loop (input parse errors).
 */

import { type FileHandle, open } from "node:fs/promises";
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
import type { ReadTracker } from "./read-tracker.js";

/** Max single-file read size, in bytes. 5 MB ceiling — enough for any source file. */
const MAX_FILE_SIZE = 5 * 1024 * 1024;

/** Byte window inspected for null bytes when deciding binary vs text. */
const BINARY_PROBE_BYTES = 8 * 1024;

export interface CreateReadFileToolOptions {
  /** Absolute path to the project root. Every read is gated against this boundary. */
  projectRoot: string;
  /**
   * SE32 — optional read-before-write tracker. When provided, a successful read
   * records the file's mtime so a paired `write_file` (with
   * `requireReadBeforeWrite`) can refuse a blind or stale overwrite.
   */
  readTracker?: ReadTracker;
}

export function createReadFileTool(opts: CreateReadFileToolOptions): CustomTool {
  const { projectRoot, readTracker } = opts;

  return defineTool({
    name: "read_file",
    description:
      "Read a project-relative text file as UTF-8. ALWAYS read a file before you edit it " +
      "(edit_file) or overwrite it (write_file), so your old_string / new content matches the " +
      "real bytes exactly. Returns the WHOLE file (there is no offset or line-range parameter); " +
      "to locate a symbol inside a large file, use search_text instead of re-reading. Refuses " +
      "paths that escape the project root, sensitive files (.env, .git/, node_modules/, .theo/, " +
      "lock files), and binary files (null byte in the first 8 KB); caps at 5 MB. Returns " +
      "{ ok, content, size } or { ok: false, error }.",
    inputSchema: z.object({
      path: z.string().min(1).describe("Project-relative file path."),
    }),
    handler: async ({ path }) => {
      if (isForbiddenPath(path)) {
        return JSON.stringify({ ok: false, error: "forbidden_path", path });
      }
      const boundary = resolveBoundary(path, projectRoot);
      if ("error" in boundary) return boundary.error;
      const opened = await openHandleSafe(boundary.absolutePath, path);
      if ("error" in opened) return opened.error;
      try {
        return await readContent(opened.handle, path, (mtimeMs) =>
          readTracker?.record(path, mtimeMs),
        );
      } finally {
        await opened.handle.close();
      }
    },
  });
}

function resolveBoundary(
  path: string,
  projectRoot: string,
): { absolutePath: string } | { error: string } {
  try {
    const absolutePath = safePathJoin(projectRoot, path);
    assertNoSymlinkEscape(absolutePath, projectRoot);
    return { absolutePath };
  } catch (err) {
    if (err instanceof PathTraversalError || err instanceof ForbiddenPathError) {
      return { error: JSON.stringify({ ok: false, error: "path_traversal", path }) };
    }
    throw err;
  }
}

async function openHandleSafe(
  absolutePath: string,
  path: string,
): Promise<{ handle: FileHandle } | { error: string }> {
  try {
    const handle = await open(absolutePath, "r");
    return { handle };
  } catch (err) {
    const e = err as { code?: string };
    if (e.code === "ENOENT") {
      return { error: JSON.stringify({ ok: false, error: "not_found", path }) };
    }
    throw err;
  }
}

async function readContent(
  handle: FileHandle,
  path: string,
  onRead?: (mtimeMs: number) => void,
): Promise<string> {
  const stat = await handle.stat();
  if (stat.size > MAX_FILE_SIZE) {
    return JSON.stringify({
      ok: false,
      error: "too_large",
      path,
      size: stat.size,
      limit: MAX_FILE_SIZE,
    });
  }
  if (await isBinaryProbe(handle, Number(stat.size))) {
    return JSON.stringify({ ok: false, error: "binary_file", path, size: stat.size });
  }
  const content = await handle.readFile({ encoding: "utf-8" });
  // SE32 — record the mtime read-before-write compares against. This is the
  // mtime captured at `handle.stat()` above; a concurrent external write between
  // that stat and this readFile is an accepted TOCTOU (the recorded snapshot may
  // trail the delivered content by one write — same-user local context). The
  // write-side guard still catches the common "edited after I read it" case.
  onRead?.(stat.mtimeMs);
  return JSON.stringify({ ok: true, content, size: stat.size });
}

async function isBinaryProbe(handle: FileHandle, size: number): Promise<boolean> {
  const probeLen = Math.min(BINARY_PROBE_BYTES, size);
  if (probeLen <= 0) return false;
  const probe = Buffer.alloc(probeLen);
  const { bytesRead } = await handle.read(probe, 0, probeLen, 0);
  for (let i = 0; i < bytesRead; i += 1) {
    if (probe[i] === 0) return true;
  }
  return false;
}
