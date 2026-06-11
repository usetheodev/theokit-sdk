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
