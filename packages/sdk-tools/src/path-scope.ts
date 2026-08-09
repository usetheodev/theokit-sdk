/**
 * Shared `safePathJoin + assertNoSymlinkEscape` helper for built-in coding
 * tools (git-diff, run-vitest, list-dir, read-file, search-text). Returns a
 * pre-formatted `path_traversal` JSON string on failure or `null` on pass.
 *
 * @internal
 */

import {
  assertNoSymlinkEscape,
  ForbiddenPathError,
  PathTraversalError,
  safePathJoin,
} from "./internal/path-guard.js";

export function checkPathScope(path: string | undefined, projectRoot: string): string | null {
  if (path === undefined || path === "") return null;
  try {
    const abs = safePathJoin(projectRoot, path);
    assertNoSymlinkEscape(abs, projectRoot);
    return null;
  } catch (err) {
    if (err instanceof PathTraversalError || err instanceof ForbiddenPathError) {
      return JSON.stringify({ ok: false, error: "path_traversal", path });
    }
    throw err;
  }
}

/**
 * Segments that may never appear in a path honored by `allowAbsolute`.
 *
 * M76 — promoted from `read-file.ts`, where it was private. Duplicating it in `list-dir` would duplicate
 * security KNOWLEDGE: the copies would have to agree on what counts as a secret, and one fixed
 * without the other reopens the hole in the forgotten tool.
 */
const SENSITIVE_SEGMENTS = new Set([".env", ".git", "node_modules", ".theo"]);

/**
 * ANY-segment secret guard — the half of `allowAbsolute` that cannot be separated.
 *
 * `isForbiddenPath` only blocks the sensitive item when it is the FIRST segment (relative to the
 * project). An absolute path (`/home/u/proj/.env/sub`) puts it deeper, and it would pass. This one
 * checks every segment, closing the "reads-anywhere" exfiltration.
 */
export function isForbiddenAtAnyDepth(path: string): boolean {
  const segs = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return segs.some((s) => {
    if (s === ".env.example") return false; // a template — safe
    return SENSITIVE_SEGMENTS.has(s) || /^\.env\./.test(s);
  });
}
