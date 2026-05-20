/**
 * Barrel for the canonical secret-redaction module (ADRs D68-D73).
 *
 * Consumers across the SDK output boundaries import from here:
 * `internal/errors/mappers/shared.ts`, `internal/telemetry/tracer.ts`,
 * `internal/runtime/agent-session-store.ts`,
 * `internal/memory/migrate-sqlite-to-lance.ts`.
 *
 * @internal
 */

export {
  assertNoSymlinkEscape,
  PathTraversalError,
  safePathJoin,
  sanitizeIdentifier,
} from "./path-guard.js";
export { addPattern, maskToken, redactSecrets } from "./redact.js";
