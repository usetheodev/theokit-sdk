/**
 * Canonical path-guard module (ADRs D79-D81).
 *
 * Three primitives + one typed error:
 *   - `safePathJoin(base, ...parts)` — resolve THEN prefix-check (ADR D80).
 *   - `assertNoSymlinkEscape(path, base)` — `realpathSync` resolves entire
 *     symlink chain (EC-1 fix; Hermes v0.2 #386, #61).
 *   - `sanitizeIdentifier(input, { maxLen })` — strict grammar
 *     `^[a-z0-9][a-z0-9-_]*$` (ADR D81; case-insensitive on input,
 *     lowercase on output).
 *   - `PathTraversalError` — extends ConfigurationError with code
 *     `path_traversal` (ADR D65: no new hierarchy).
 *
 * Wire at all sites where user input becomes a path. CI lint gate
 * `tests/lint/no-unguarded-path-input.test.ts` prevents regression
 * (ADR D85).
 *
 * @internal
 */

import { lstatSync, readlinkSync, realpathSync, type Stats } from "node:fs";
import { dirname, resolve, sep } from "node:path";

import { ConfigurationError } from "../../errors.js";

/**
 * Thrown when a path operation would escape its allowed base directory.
 * Extends `ConfigurationError` (no new error hierarchy per ADR D65).
 *
 * @internal
 */
export class PathTraversalError extends ConfigurationError {
  override readonly name: string = "PathTraversalError";

  constructor(input: string, resolvedPath: string) {
    super(`Path traversal attempt: ${input} → ${resolvedPath}`, {
      code: "path_traversal",
    });
  }
}

/**
 * Join `base` with `...parts` and ensure the resolved absolute path stays
 * under `base`. Resolves FIRST, then prefix-checks (ADR D80) — prevents
 * normalized-escape bypasses like `subdir/.\\./bar`.
 *
 * Returns the safe absolute path. Throws `PathTraversalError` if escape.
 *
 * @internal
 */
export function safePathJoin(base: string, ...parts: string[]): string {
  if (base === "") {
    throw new Error("safePathJoin: base must be non-empty");
  }
  const baseResolved = resolve(base);
  const target = resolve(base, ...parts);
  if (target !== baseResolved && !target.startsWith(baseResolved + sep)) {
    throw new PathTraversalError(parts.join("/"), target);
  }
  return target;
}

/**
 * If `path` is a symlink, follow the ENTIRE chain via `realpathSync`
 * and assert the final target stays under `base`. No-op when path is
 * a regular file or does not exist.
 *
 * EC-1 fix (edge-case review): `realpathSync` resolves multi-level
 * chains (A → B → C → ...) in 1 syscall. `readlinkSync` would only
 * return the first hop, leaving chains as a bypass vector.
 *
 * @internal
 */
export function assertNoSymlinkEscape(path: string, base: string): void {
  let stat: Stats;
  try {
    stat = lstatSync(path);
  } catch {
    return; // path doesn't exist — no escape risk
  }
  if (!stat.isSymbolicLink()) return;

  const baseResolved = realpathSync(base);

  let resolvedTarget: string;
  try {
    // EC-1 fix: realpathSync resolves the entire symlink chain in 1 syscall.
    resolvedTarget = realpathSync(path);
  } catch {
    // Dangling symlink (target nonexistent or unreadable). Fall back to
    // single-level resolve via readlinkSync so we still detect escapes
    // that an attacker prepared in advance for a future create.
    const target = readlinkSync(path);
    resolvedTarget = resolve(dirname(path), target);
  }

  if (resolvedTarget !== baseResolved && !resolvedTarget.startsWith(baseResolved + sep)) {
    throw new PathTraversalError(`symlink ${path}`, resolvedTarget);
  }
}

const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9\-_]*$/i;

/**
 * Validate that `input` is a safe path component (skill name, agent ID,
 * namespace, etc.) and return its lowercase form. Strict grammar
 * `^[a-z0-9][a-z0-9-_]*$` rejects path separators, dots, null bytes,
 * whitespace, unicode invisible chars, and any leading `-`/`_`.
 *
 * @param input - User-supplied identifier candidate.
 * @param options.maxLen - Maximum allowed length (default 64).
 * @returns Lowercase form of `input`.
 * @throws `ConfigurationError` with code `invalid_identifier` on rejection.
 *
 * @internal
 */
export function sanitizeIdentifier(input: string, options?: { maxLen?: number }): string {
  const maxLen = options?.maxLen ?? 64;
  if (input.length === 0 || input.length > maxLen) {
    throw new ConfigurationError(`Identifier length out of range (1-${maxLen}): "${input}"`, {
      code: "invalid_identifier",
    });
  }
  if (!IDENTIFIER_PATTERN.test(input)) {
    throw new ConfigurationError(`Identifier contains invalid characters: "${input}"`, {
      code: "invalid_identifier",
    });
  }
  return input.toLowerCase();
}
