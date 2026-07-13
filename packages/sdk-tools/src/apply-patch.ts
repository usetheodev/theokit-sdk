/**
 * `apply_patch` — built-in tool for coding agents.
 *
 * Parses a unified diff string and applies it to the project files.
 * Creates `.bak` backups before modifying each file.
 *
 * Return shape (always a JSON string):
 *   - `{ ok: true, files_patched: string[] }`
 *   - `{ ok: false, error: 'parse_error' | 'path_traversal' |
 *        'forbidden_path' | 'patch_failed' }`
 */

import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { CustomTool } from "@theokit/sdk";

import { Tool } from "@theokit/sdk";
import { z } from "zod";
import {
  assertNoSymlinkEscape,
  ForbiddenPathError,
  isForbiddenPath,
  PathTraversalError,
  safePathJoin,
} from "./internal/path-guard.js";

export interface CreateApplyPatchToolOptions {
  /** Absolute path to the project root. */
  projectRoot: string;
}

export function createApplyPatchTool(opts: CreateApplyPatchToolOptions): CustomTool {
  const { projectRoot } = opts;

  return Tool.create({
    name: "apply_patch",
    description:
      "Apply a unified diff patch to project files. Each file in the diff " +
      "is security-checked against the project root. Creates .bak backups " +
      "before modifying. Returns { ok, files_patched } or { ok: false, error }.",
    inputSchema: z.object({
      patch: z.string().min(1).describe("Unified diff content."),
    }),
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: unified diff parsing is inherently complex
    handler: async ({ patch }) => {
      const hunks = parsePatch(patch);
      if (hunks.length === 0) {
        return JSON.stringify({ ok: false, error: "parse_error", detail: "no file hunks found" });
      }

      // Security check all paths upfront
      for (const hunk of hunks) {
        if (isForbiddenPath(hunk.file)) {
          return JSON.stringify({ ok: false, error: "forbidden_path", path: hunk.file });
        }
        try {
          const abs = safePathJoin(projectRoot, hunk.file);
          assertNoSymlinkEscape(abs, projectRoot);
        } catch (err) {
          if (err instanceof PathTraversalError || err instanceof ForbiddenPathError) {
            return JSON.stringify({ ok: false, error: "path_traversal", path: hunk.file });
          }
          throw err;
        }
      }

      // Apply each file's hunks
      const patched: string[] = [];
      for (const hunk of hunks) {
        const absolutePath = safePathJoin(projectRoot, hunk.file);
        let content: string;
        try {
          content = await readFile(absolutePath, "utf-8");
        } catch (err) {
          const e = err as { code?: string };
          if (e.code === "ENOENT") {
            // New file — start empty
            content = "";
          } else {
            throw err;
          }
        }

        const result = applyHunks(content, hunk.changes);
        if (result === null) {
          return JSON.stringify({
            ok: false,
            error: "patch_failed",
            path: hunk.file,
            detail: "hunk context mismatch",
          });
        }

        if (content !== "") {
          await copyFile(absolutePath, `${absolutePath}.bak`);
        }
        await mkdir(dirname(absolutePath), { recursive: true });
        await writeFile(absolutePath, result, "utf-8");
        patched.push(hunk.file);
      }

      return JSON.stringify({ ok: true, files_patched: patched });
    },
  });
}

interface FileHunk {
  file: string;
  changes: HunkChange[];
}

interface HunkChange {
  type: "add" | "remove" | "context";
  content: string;
}

/** Simple unified diff parser — extracts file paths and line changes. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: parser logic
function parsePatch(patch: string): FileHunk[] {
  const lines = patch.split("\n");
  const hunks: FileHunk[] = [];
  let current: FileHunk | null = null;

  for (const line of lines) {
    // Detect file header: +++ b/path or +++ path
    if (line.startsWith("+++ ")) {
      const filePath = line.slice(4).replace(/^b\//, "").trim();
      if (filePath && filePath !== "/dev/null") {
        current = { file: filePath, changes: [] };
        hunks.push(current);
      }
      continue;
    }

    if (line.startsWith("--- ")) continue;
    if (line.startsWith("@@ ")) continue;

    if (current === null) continue;

    if (line.startsWith("+")) {
      current.changes.push({ type: "add", content: line.slice(1) });
    } else if (line.startsWith("-")) {
      current.changes.push({ type: "remove", content: line.slice(1) });
    } else if (line.startsWith(" ")) {
      current.changes.push({ type: "context", content: line.slice(1) });
    }
  }

  return hunks;
}

/** Apply hunk changes to file content. Returns null on context mismatch. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: parser logic
function applyHunks(content: string, changes: HunkChange[]): string | null {
  const originalLines = content.split("\n");
  const result: string[] = [];
  let origIdx = 0;

  // Find context start
  const firstContext = changes.find((c) => c.type === "context" || c.type === "remove");
  if (firstContext) {
    const startIdx = originalLines.indexOf(firstContext.content, origIdx);
    if (startIdx === -1) return null;
    // Copy lines before context
    for (let i = 0; i < startIdx; i++) {
      result.push(originalLines[i]!);
    }
    origIdx = startIdx;
  }

  for (const change of changes) {
    if (change.type === "context") {
      if (origIdx >= originalLines.length || originalLines[origIdx] !== change.content) {
        return null; // context mismatch
      }
      result.push(change.content);
      origIdx++;
    } else if (change.type === "remove") {
      if (origIdx >= originalLines.length || originalLines[origIdx] !== change.content) {
        return null; // line to remove doesn't match
      }
      origIdx++;
    } else if (change.type === "add") {
      result.push(change.content);
    }
  }

  // Append remaining original lines
  while (origIdx < originalLines.length) {
    result.push(originalLines[origIdx]!);
    origIdx++;
  }

  return result.join("\n");
}
