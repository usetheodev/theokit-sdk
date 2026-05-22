/**
 * Public path-safety primitives.
 *
 * Thin re-export of the canonical implementation in
 * `internal/security/path-guard.ts`. Splitting this into its own
 * top-level module gives `rollup-plugin-dts` a clean boundary when
 * bundling declarations — without it, including the path-guard module
 * via the main barrel propagates a cascade of transitive imports that
 * surface a known-spurious "ForkOptions not exported" error from
 * `types/agent.ts` (dynamic-import-type quirk in rollup-plugin-dts).
 *
 * See `docs.md → Security — path traversal + TOCTOU` for the full
 * primitive reference. Public from v1.x.
 */

export {
  assertNoSymlinkEscape,
  ForbiddenPathError,
  isForbiddenPath,
  PathTraversalError,
  safePathJoin,
} from "./internal/security/path-guard.js";
