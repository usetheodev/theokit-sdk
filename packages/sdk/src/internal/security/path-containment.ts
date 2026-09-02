/**
 * The one rule for "is this resolved path inside that root".
 *
 * Extracted because the package held it twice, at different strengths, for the same question. The
 * correct version lived as a private function in `context-import-resolver.ts`, written for the
 * 4.41.1 patch; the context manager had its own `absolute.startsWith(resolvePath(cwd))`, which
 * admits two escapes:
 *
 *   - **No separator boundary.** With `root = /home/user/proj`, the path `/home/user/proj-evil/x`
 *     starts with the root string and is NOT inside it. A sibling directory whose name merely
 *     extends the project's is enough; no `..` past the parent is needed.
 *   - **Lexical, not real.** A symlink whose name sits inside the root and whose target does not
 *     passes any comparison made before symlink resolution.
 *
 * The obvious escapes (`../../etc/passwd`, an absolute path) ARE refused by a prefix test, which is
 * why the weaker version survived review: it looks like it works on the inputs a reader tries.
 *
 * Both readers of repository-supplied paths now share this module. That is DRY about the RULE
 * rather than about line count — one piece of knowledge, one representation, so the two cannot
 * drift apart again.
 *
 * @internal
 */

import { realpathSync } from "node:fs";
import { isAbsolute, relative } from "node:path";

/**
 * The real path, or the lexical one when it cannot be resolved.
 *
 * The fallback is load-bearing rather than defensive: the context manager checks containment BEFORE
 * it stats the file, so a source that is legitimately absent must still be judged on its declared
 * location instead of being refused for the wrong reason.
 *
 * @internal
 */
export function realOrResolved(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * Whether `target` is inside `root`, compared AFTER symlink resolution.
 *
 * `relative()` supplies the separator boundary that a prefix test lacks: it answers `..` for a
 * sibling, `''` for the root itself, and an absolute path when the two are on different roots.
 *
 * @internal
 */
export function insideRoot(target: string, root: string): boolean {
  const rel = relative(realOrResolved(root), realOrResolved(target));
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/**
 * Whether `target` is the root ITSELF or inside it, compared after symlink resolution.
 *
 * Separate from {@link insideRoot} because the two answer a genuinely different question and their
 * callers need different ones. The context manager asks "is this source under the project?", where
 * the project directory itself is not a source. A path JOIN asks "did this stay within its base?",
 * where joining nothing and getting the base back is the ordinary case — `safePathJoin(base)` must
 * return `base`.
 *
 * Named here rather than written out at each call site: it appeared twice within one change, which
 * is how this rule ended up with three copies at three strengths the first time.
 *
 * @internal
 */
export function atOrInsideRoot(target: string, root: string): boolean {
  return insideRoot(target, root) || realOrResolved(target) === realOrResolved(root);
}
