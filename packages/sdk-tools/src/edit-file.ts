/**
 * `edit_file` — built-in tool for coding agents.
 *
 * Replaces a string in a project-relative file. Tries exact match first,
 * then whitespace-normalized match. Creates a `.bak` backup before editing.
 *
 * Return shape (always a JSON string):
 *   - `{ ok: true, replacements: 1 }` on success
 *   - `{ ok: false, error: 'no_match' | 'not_found' | 'path_traversal' |
 *        'forbidden_path' }` on refusal
 */

import { copyFile, readFile, writeFile } from "node:fs/promises";
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

export interface CreateEditFileToolOptions {
  /** Absolute path to the project root. Every edit is gated against this boundary. */
  projectRoot: string;
}

export function createEditFileTool(opts: CreateEditFileToolOptions): CustomTool {
  const { projectRoot } = opts;

  return Tool.create({
    name: "edit_file",
    description:
      "Make an exact string replacement in a project-relative file. Replaces the FIRST occurrence " +
      "of old_string with new_string (a whitespace-normalized fallback is attempted if the exact " +
      "match fails) and writes a .bak backup first. Read the file first so old_string matches the " +
      "on-disk text exactly; include enough surrounding context to make it unique — only the first " +
      "match is replaced, so a too-short old_string can edit the wrong location. old_string must be " +
      "non-empty and differ from new_string; to change every occurrence, call edit_file repeatedly. " +
      "Returns { ok, replacements } or { ok: false, error }.",
    inputSchema: z.object({
      path: z.string().min(1).describe("Project-relative file path."),
      old_string: z.string().min(1).describe("String to find in the file."),
      new_string: z.string().describe("Replacement string."),
    }),
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: unified diff parsing is inherently complex
    handler: async ({ path, old_string, new_string }) => {
      // A no-op edit (old === new) cannot change the file; refuse early so the description's
      // "old_string must differ from new_string" precondition is enforced, not just documented.
      if (old_string === new_string) {
        return JSON.stringify({ ok: false, error: "no_change", path });
      }
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

      let content: string;
      try {
        content = await readFile(absolutePath, "utf-8");
      } catch (err) {
        const e = err as { code?: string };
        if (e.code === "ENOENT") {
          return JSON.stringify({ ok: false, error: "not_found", path });
        }
        throw err;
      }

      // Strategy 1: exact match
      const exactIdx = content.indexOf(old_string);
      if (exactIdx !== -1) {
        await copyFile(absolutePath, `${absolutePath}.bak`);
        const result =
          content.slice(0, exactIdx) + new_string + content.slice(exactIdx + old_string.length);
        await writeFile(absolutePath, result, "utf-8");
        return JSON.stringify({ ok: true, replacements: 1 });
      }

      // Strategy 2: whitespace-normalized match
      const normalizedContent = normalizeWhitespace(content);
      const normalizedOld = normalizeWhitespace(old_string);
      const normalizedIdx = normalizedContent.indexOf(normalizedOld);

      if (normalizedIdx === -1) {
        return JSON.stringify({ ok: false, error: "no_match", path });
      }

      // Find original span boundaries via character mapping
      const span = findOriginalSpan(
        content,
        normalizedContent,
        normalizedIdx,
        normalizedOld.length,
      );
      await copyFile(absolutePath, `${absolutePath}.bak`);
      const result = content.slice(0, span.start) + new_string + content.slice(span.end);
      await writeFile(absolutePath, result, "utf-8");
      return JSON.stringify({ ok: true, replacements: 1 });
    },
  });
}

/** Collapse runs of whitespace into a single space. */
function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Map a position range in the whitespace-normalized string back to the
 * original string. Walks both strings in lockstep.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: parser logic
function findOriginalSpan(
  original: string,
  _normalized: string,
  normStart: number,
  normLen: number,
): { start: number; end: number } {
  let origIdx = 0;
  let normIdx = 0;

  // Skip leading whitespace that was trimmed
  while (origIdx < original.length && /\s/.test(original[origIdx]!)) {
    origIdx++;
  }

  // Walk to normStart
  while (normIdx < normStart && origIdx < original.length) {
    if (/\s/.test(original[origIdx]!)) {
      // skip entire whitespace run in original, counts as one in normalized
      while (origIdx < original.length && /\s/.test(original[origIdx]!)) {
        origIdx++;
      }
      normIdx++; // the collapsed space
    } else {
      origIdx++;
      normIdx++;
    }
  }

  const start = origIdx;

  // Walk normLen characters
  let walked = 0;
  while (walked < normLen && origIdx < original.length) {
    if (/\s/.test(original[origIdx]!)) {
      while (origIdx < original.length && /\s/.test(original[origIdx]!)) {
        origIdx++;
      }
      walked++; // the collapsed space
    } else {
      origIdx++;
      walked++;
    }
  }

  return { start, end: origIdx };
}
