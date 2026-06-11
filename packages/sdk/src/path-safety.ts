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
  // Iter 52 (SDK 2.0 Phase 1 Stage 3 source-move): promoted to public
  // so sdk-memory's hybrid `internal/memory-types.ts` can sanitize
  // namespace/scope/userId without reaching into sdk-core internals.
  // Same strict grammar, same maxLen option — identical behavior to
  // the v1.x internal export. Stable from this point.
  sanitizeIdentifier,
} from "./internal/security/path-guard.js";
