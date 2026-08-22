/**
 * Barrel for the canonical secret-redaction module (ADRs D68-D73).
 *
 * Consumers across the SDK output boundaries import from here:
 * `internal/error-mappers/shared.ts`, `internal/telemetry/tracer.ts`,
 * `internal/runtime/agent-session-store.ts`,
 * `internal/memory/migrate-sqlite-to-lance.ts`.
 *
 * Semver-exempt: the `@theokit/sdk/internal/security` sub-path exists for packages extracted out of
 * this one and is NOT covered by the package's semver contract. It IS declared in `package.json`
 * `exports`, so every name below must survive into the published declarations.
 */

export {
  assertNoSymlinkEscape,
  ForbiddenPathError,
  isForbiddenPath,
  PathTraversalError,
  safePathJoin,
  sanitizeIdentifier,
  validateArtifactPath,
} from "./path-guard.js";
export { addPattern, maskToken, redactSecrets } from "./redact.js";
