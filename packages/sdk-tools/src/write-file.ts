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

export interface CreateWriteFileToolOptions {
  /** Absolute path to the project root. Every write is gated against this boundary. */
  projectRoot: string;
}

export function createWriteFileTool(opts: CreateWriteFileToolOptions): CustomTool {
  const { projectRoot } = opts;

  return defineTool({
    name: "write_file",
    description:
      "Write UTF-8 content to a project-relative file. Creates parent " +
      "directories recursively. Refuses paths that escape the project root, " +
      "sensitive files (.env, .git/, node_modules/, .theo/, lock files), " +
      "and binary-file overwrites. Returns { ok, path, bytes } or " +
      "{ ok: false, error }.",
    inputSchema: z.object({
      path: z.string().min(1).describe("Project-relative file path."),
      content: z.string().describe("UTF-8 content to write."),
    }),
    handler: async ({ path, content }) => {
      if (isForbiddenPath(path)) {
        return JSON.stringify({ ok: false, error: "forbidden_path", path });
      }

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
    },
  });
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
