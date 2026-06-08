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

import { ConfigurationError } from "@theokit/sdk";

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
 * Thrown when an agent tool is asked to read or write a sensitive path
 * that the blocklist forbids (`.env`, `.git/`, `node_modules/`, `.theo/`,
 * lock files). Distinct from `PathTraversalError` because the path is
 * lexically inside the project — it is just sensitive.
 *
 * Extends `ConfigurationError` (no new error hierarchy per ADR D65).
 *
 * @public
 */
export class ForbiddenPathError extends ConfigurationError {
  override readonly name: string = "ForbiddenPathError";

  constructor(path: string) {
    super(
      `Path '${path}' is in the sensitive-file blocklist (.env, .git/, node_modules/, .theo/, lock files)`,
      {
        code: "forbidden_path",
      },
    );
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
 * Assert that `path` — including every directory component in the chain —
 * stays under `base` after symlink resolution. No-op when nothing on the
 * path exists yet.
 *
 * Two-bug history:
 *   1. **EC-1** (original fix, kept): a multi-level symlink chain A → B → C
 *      must be resolved end-to-end. `realpathSync` does this in 1 syscall.
 *   2. **Defence-in-depth** (added v1.x): the previous implementation only
 *      called `lstatSync(path)` on the terminal component. If an INTERMEDIATE
 *      directory was a symlink (`base/inner-symlink → /outside`), `lstat` on
 *      `base/inner-symlink/file.txt` followed the symlink and reported the
 *      regular file — escape went undetected. Fix: walk up to the nearest
 *      existing ancestor and `realpath` THAT, then re-attach the suffix and
 *      check the result against the canonical base.
 *
 * @internal
 */
export function assertNoSymlinkEscape(path: string, base: string): void {
  // Canonical base — symlinks in the base path itself are absorbed once here.
  let baseResolved: string;
  try {
    baseResolved = realpathSync(base);
  } catch {
    // base doesn't exist as a real directory yet — fall back to lexical resolve.
    baseResolved = resolve(base);
  }

  // Find the deepest ancestor of `path` that exists, then realpath it.
  // Anything from there onward is "not yet on disk" and contributes only
  // its lexical suffix. This covers three cases:
  //   - path exists (regular file or symlink at any depth) → realpath the full path
  //   - path doesn't exist but intermediate dir is a symlink → realpath the ancestor
  //   - nothing on the path exists → no escape risk (return)
  const resolved = realpathOfDeepestExisting(path);
  if (resolved === undefined) return; // path has no existing prefix — nothing to attack

  if (resolved !== baseResolved && !resolved.startsWith(baseResolved + sep)) {
    throw new PathTraversalError(`symlink ${path}`, resolved);
  }
}

/**
 * Find the deepest ancestor of `path` that exists on disk, resolve all
 * symlinks in that ancestor via `realpathSync`, and re-attach the
 * lexical suffix. Returns `undefined` when no ancestor exists.
 *
 * Handles dangling symlinks: if the terminal IS a symlink but its target
 * is missing, we still detect escape via `readlinkSync` + parent resolve.
 */
function realpathOfDeepestExisting(path: string): string | undefined {
  // First try the full path — the common case.
  try {
    return realpathSync(path);
  } catch {
    // Not resolvable. Two sub-cases.
  }

  // Sub-case A: terminal is a dangling symlink.
  try {
    const stat: Stats = lstatSync(path);
    if (stat.isSymbolicLink()) {
      const target = readlinkSync(path);
      // Resolve target relative to the REAL parent dir, so intermediate
      // symlinks in the parent chain are absorbed.
      const parentReal = realpathOfDeepestExisting(dirname(path));
      const parentBase = parentReal ?? dirname(path);
      return resolve(parentBase, target);
    }
  } catch {
    // lstat failed too — terminal doesn't exist at all.
  }

  // Sub-case B: walk up to the nearest existing ancestor, then re-attach
  // the suffix lexically.
  let cursor = dirname(path);
  let suffix = path.slice(cursor.length);
  while (cursor !== dirname(cursor)) {
    try {
      const real = realpathSync(cursor);
      // Reconstruct: ancestor's realpath + remaining (still-lexical) suffix
      return resolve(real, `.${suffix}`);
    } catch {
      suffix = path.slice(dirname(cursor).length);
      cursor = dirname(cursor);
    }
  }
  // Reached filesystem root without finding any existing ancestor.
  return undefined;
}

const LOCK_FILES = new Set(["pnpm-lock.yaml", "package-lock.json", "yarn.lock", "bun.lockb"]);

/**
 * Decide whether a project-relative path points to a known-sensitive file
 * that a coding agent must not read or write.
 *
 * Universal blocklist (works for any agent operating on a project tree):
 *
 *   - `.env`, `.env.<anything>` — except `.env.example` (template safe to read)
 *   - `.git/` — version control internals
 *   - `node_modules/` — dependency cache (changes don't belong to the user)
 *   - `.theo/` — TheoKit build artefacts / state
 *   - Lock files at any depth: `pnpm-lock.yaml`, `package-lock.json`,
 *     `yarn.lock`, `bun.lockb`
 *
 * Operates on path segments (forward-slash normalized). Cross-platform safe.
 *
 * Use together with `safePathJoin` + `assertNoSymlinkEscape`: the former two
 * defeat traversal, this one defeats reading a file that is lexically inside
 * the project but should not be agent-visible.
 *
 * @public
 */
export function isForbiddenPath(input: string): boolean {
  // Normalize: forward slashes only, strip leading "./"
  const normalized = input.replace(/\\/g, "/").replace(/^\.\//, "");
  if (normalized.length === 0) return false;

  const segments = normalized.split("/").filter((s) => s.length > 0);
  if (segments.length === 0) return false;

  const first = segments[0]!;
  // .env.example is explicitly allowlisted (template safe to read)
  if (first === ".env.example") return false;
  if (first === ".env") return true;
  if (/^\.env\./.test(first)) return true;

  if (first === ".git") return true;
  if (first === "node_modules") return true;
  if (first === ".theo") return true;

  const basename = segments[segments.length - 1]!;
  if (LOCK_FILES.has(basename)) return true;

  return false;
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
/**
 * T1.4 — validate a relative artifact path string BEFORE it is used to look
 * up a fixture or to fetch from PaaS. Rejects every well-known traversal
 * vector at the boundary, throwing `PathTraversalError`.
 *
 * Vectors rejected:
 *  - classic `..` parent-directory traversal (any segment).
 *  - backslash separators (Windows-style `..\\windows`).
 *  - URL-encoded `%2e%2e` / `%2E%2E` (double-decoded traversal).
 *  - NUL byte injection (`\x00`).
 *  - Windows drive letter prefix (`C:`, `D:\\...`).
 *  - Home-tilde expansion (`~/`, `~root/...`).
 *  - Absolute paths starting with `/`.
 *
 * Does NOT touch the filesystem — the call is shape-only. Live symlink
 * traversal protection happens via `assertNoSymlinkEscape` at the FS-resolve
 * boundary.
 *
 * @param input - Caller-supplied artifact path.
 * @throws `PathTraversalError` on any rejection.
 *
 * @internal
 */
export function validateArtifactPath(input: string): void {
  rejectKnownPrefixVectors(input);
  const normalized = decodeAndNormalize(input);
  rejectParentTraversal(input, normalized);
}

function rejectKnownPrefixVectors(input: string): void {
  if (input.includes("\x00")) {
    throw new PathTraversalError(input, "<nul-byte>");
  }
  if (input.startsWith("/") || input.startsWith("~")) {
    throw new PathTraversalError(input, input);
  }
  if (/^[A-Za-z]:[\\/]?/.test(input)) {
    throw new PathTraversalError(input, input);
  }
}

function decodeAndNormalize(input: string): string {
  // URL-encoded traversal — 2 passes catches `%252e%252e`.
  // Malformed sequences (decodeURIComponent throws) are themselves a rejection.
  let decoded = input;
  for (let i = 0; i < 2; i += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      throw new PathTraversalError(input, "<malformed-url-encoding>");
    }
  }
  // Normalize backslash to forward slash before segment-walking.
  return decoded.replace(/\\/g, "/");
}

function rejectParentTraversal(input: string, normalized: string): void {
  for (const segment of normalized.split("/")) {
    if (segment === ".." || segment === "..%00") {
      throw new PathTraversalError(input, normalized);
    }
  }
  // Defense in depth: literal `..` anywhere in the normalized string.
  if (normalized.includes("..")) {
    throw new PathTraversalError(input, normalized);
  }
}

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
