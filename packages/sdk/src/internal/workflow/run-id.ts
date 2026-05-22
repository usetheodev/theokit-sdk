/**
 * Generate a short, deterministic workflow run identifier.
 *
 * Format: `wfr-<8 hex chars>`. Used for span keys, snapshot filenames, and
 * single-flight registry keys.
 *
 * @internal
 */

export function mintRunId(): string {
  return `wfr-${globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
}
