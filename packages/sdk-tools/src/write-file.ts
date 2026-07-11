/**
 * `write_file` — built-in tool for coding agents.
 *
 * Writes UTF-8 content to a project-relative path. Creates parent
 * directories recursively. Refuses binary-file overwrites, path
 * traversal, and sensitive paths.
 *
 * Return shape (always a JSON string):
 *   - `{ ok: true, path, bytes }` on success
 *   - `{ ok: false, error: 'path_traversal' | 'forbidden_path' |
 *        'binary_file' }` on refusal
 */

import { mkdir, open, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { CustomTool } from "@theokit/sdk";
import { defineTool } from "@theokit/sdk";
import {
  type FilesystemBackend,
  FilesystemError,
  type FilesystemProvider,
  FilesystemReadOnlyError,
  FilesystemSecurityError,
  resolveFilesystem,
  StaleFileError,
} from "@theokit/sdk/filesystem";
import { z } from "zod";
import {
  assertNoSymlinkEscape,
  ForbiddenPathError,
  isForbiddenPath,
  PathTraversalError,
  safePathJoin,
} from "./internal/path-guard.js";

/** Byte window inspected for null bytes when deciding binary vs text. */
const BINARY_PROBE_BYTES = 8 * 1024;

/** The run-scoped context a `defineTool` handler receives as its 2nd argument. */
type WriteToolContext = { signal?: AbortSignal; context?: unknown };

export interface CreateWriteFileToolOptions {
  /** Absolute path to the project root. Every write is gated against this boundary. */
  projectRoot: string;
  /**
   * SE31 — optional pluggable filesystem backend (`@theokit/sdk/filesystem`), or
   * a per-request resolver `(ctx) => FilesystemBackend`. When provided, writes
   * route through it (its own boundary + `readOnly` + per-request root) instead
   * of the local project fs. Omitted ⇒ identical current behavior (local
   * `projectRoot`). The `.env`/`.git` policy still applies (storage-independent).
   */
  filesystem?: FilesystemProvider<WriteToolContext>;
}

export function createWriteFileTool(opts: CreateWriteFileToolOptions): CustomTool {
  const { projectRoot, filesystem } = opts;

  return defineTool({
    name: "write_file",
    description:
      "Write UTF-8 content to a project-relative file, creating parent directories as needed. " +
      "OVERWRITES any existing file at the path. Prefer editing an existing file with edit_file " +
      "over rewriting it; use write_file to create a NEW file or fully replace a small one. If the " +
      "file already exists, read_file it first so you do not discard content you have not seen. " +
      "Refuses paths that escape the write root and sensitive files (.env, .git/, node_modules/, " +
      ".theo/, lock files); the default local root also refuses binary-file overwrites. Returns " +
      "{ ok, path, bytes } or { ok: false, error }.",
    inputSchema: z.object({
      path: z.string().min(1).describe("Project-relative file path."),
      content: z.string().describe("UTF-8 content to write."),
    }),
    handler: async ({ path, content }, ctx) => {
      if (isForbiddenPath(path)) {
        return JSON.stringify({ ok: false, error: "forbidden_path", path });
      }
      // SE31 — route through the pluggable backend when one is configured (the
      // backend owns its own boundary, readOnly, and provider); else local fs.
      if (filesystem) {
        const backend = await resolveFilesystem(filesystem, ctx ?? {});
        return writeViaBackend(backend, path, content);
      }
      return writeViaLocalFs(projectRoot, path, content);
    },
  });
}

/** Local-`projectRoot` write path: boundary + binary guard + write. */
async function writeViaLocalFs(
  projectRoot: string,
  path: string,
  content: string,
): Promise<string> {
  let absolutePath: string;
  try {
    absolutePath = safePathJoin(projectRoot, path);
    assertNoSymlinkEscape(absolutePath, projectRoot);
  } catch (err) {
    if (err instanceof PathTraversalError || err instanceof ForbiddenPathError) {
      return JSON.stringify({ ok: false, error: "path_traversal", path });
    }
    throw err;
  }

  // Binary file guard: probe existing file for null bytes before overwriting
  if (await isBinaryFile(absolutePath)) {
    return JSON.stringify({ ok: false, error: "binary_file", path });
  }

  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, "utf-8");
  const bytes = Buffer.byteLength(content, "utf-8");

  return JSON.stringify({ ok: true, path, bytes });
}

/**
 * SE31 — write through a {@link FilesystemBackend}, mapping its typed errors to
 * the tool's `{ ok: false, error }` JSON shape (never throws on a user mistake).
 */
async function writeViaBackend(
  backend: FilesystemBackend,
  path: string,
  content: string,
): Promise<string> {
  try {
    const stat = await backend.writeFile(path, content);
    return JSON.stringify({ ok: true, path, bytes: stat.size });
  } catch (err) {
    if (err instanceof FilesystemSecurityError) {
      return JSON.stringify({ ok: false, error: "path_traversal", path });
    }
    if (err instanceof FilesystemReadOnlyError) {
      return JSON.stringify({ ok: false, error: "read_only", path });
    }
    if (err instanceof StaleFileError) {
      return JSON.stringify({ ok: false, error: "stale_file", path });
    }
    // A typed I/O failure (ENOTDIR — a path component is a file, EACCES, …) is a
    // recoverable "bad path" the agent should see, not a loop-crashing throw.
    if (err instanceof FilesystemError) {
      return JSON.stringify({ ok: false, error: "write_failed", path });
    }
    throw err;
  }
}

async function isBinaryFile(absolutePath: string): Promise<boolean> {
  let handle: import("node:fs/promises").FileHandle | undefined;
  try {
    handle = await open(absolutePath, "r");
  } catch {
    return false; // file doesn't exist yet — not binary
  }
  try {
    const stat = await handle.stat();
    const probeLen = Math.min(BINARY_PROBE_BYTES, Number(stat.size));
    if (probeLen <= 0) return false;
    const probe = Buffer.alloc(probeLen);
    const { bytesRead } = await handle.read(probe, 0, probeLen, 0);
    for (let i = 0; i < bytesRead; i += 1) {
      if (probe[i] === 0) return true;
    }
    return false;
  } finally {
    await handle.close();
  }
}
