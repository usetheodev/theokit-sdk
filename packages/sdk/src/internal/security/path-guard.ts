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

import { createHash } from "node:crypto";
import { lstatSync, readlinkSync, realpathSync, type Stats } from "node:fs";
import { dirname, resolve } from "node:path";

import { ConfigurationError } from "../../errors.js";
import { atOrInsideRoot } from "../runtime/context/path-containment.js";

/**
 * Thrown when a path operation would escape its allowed base directory.
 * Extends `ConfigurationError` (no new error hierarchy per ADR D65).
 *
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
 * Is `target` the same as `base`, or strictly under it?
 *
 * The prefix must not double the separator. `resolve` strips a trailing `sep` from every base
 * EXCEPT the filesystem root, where `resolve(sep) === sep`; there `base + sep` would be `//`, which
 * no absolute path starts with, so a root base rejected EVERY path (#149). Only the root takes that
 * branch — for any other base the prefix is unchanged, so containment is not weakened.
 *
 * Both containment checks in this module go through here: they had the same defect and were fixed
 * one at a time, which is exactly how the two drifted apart in the first place.
 *
 * Both arguments MUST already be resolved absolute paths.
 */
function isInside(target: string, base: string): boolean {
  // B-117 — compared after symlink resolution, via the shared rule. A prefix test judges a link by
  // its NAME: `<base>/link/x` where `link` points outside is lexically inside and physically not.
  // Measured reachable from the plugin manager and the MCP client before this was changed.
  //
  // The root itself stays allowed, which `insideRoot` alone does not answer: it returns false for
  // `target === base` (correct for its own caller, wrong here, where `safePathJoin(base)` with no
  // parts must return `base`). Kept as an explicit second clause rather than by weakening the
  // shared rule for everyone.
  return atOrInsideRoot(target, base);
}

/**
 * Join `base` with `...parts` and ensure the resolved absolute path stays
 * under `base`. Resolves FIRST, then prefix-checks (ADR D80) — prevents
 * normalized-escape bypasses like `subdir/.\\./bar`.
 *
 * Returns the safe absolute path. Throws `PathTraversalError` if escape.
 *
 */
export function safePathJoin(base: string, ...parts: string[]): string {
  if (base === "") {
    throw new Error("safePathJoin: base must be non-empty");
  }
  // T5.5 — NUL byte + C0/DEL control char rejection at the boundary.
  // Apply before path resolution so a malicious input never reaches
  // `resolve` (which on some platforms behaved unexpectedly with NUL
  // and in N-API callers historically silently truncated).
  rejectNulAndControlChars(base, "base");
  for (const part of parts) {
    rejectNulAndControlChars(part, "path segment");
  }
  const baseResolved = resolve(base);
  const target = resolve(base, ...parts);
  if (!isInside(target, baseResolved)) {
    throw new PathTraversalError(parts.join("/"), target);
  }
  return target;
}

/**
 * T5.5 — Reject NUL (`\x00`) and C0/DEL control characters
 * (`\x01-\x1F`, `\x7F`) in any path-shaped or identifier-shaped input.
 * Centralizes the check so every public path-guard / sanitize entrypoint
 * shares the same defense.
 *
 * Throws `PathTraversalError` (the same shape as other path-shape
 * rejections) so callers don't need to learn a new error class.
 *
 * @internal
 */
function rejectNulAndControlChars(input: string, role: string): void {
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code === 0x00 || (code >= 0x01 && code <= 0x1f) || code === 0x7f) {
      const label = code === 0x00 ? "<nul-byte>" : `<control-char-0x${code.toString(16)}>`;
      throw new PathTraversalError(`${role}: ${input}`, label);
    }
  }
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
 */
export function assertNoSymlinkEscape(path: string, base: string): void {
  // T5.5 — reject NUL / control chars before any FS call (a NUL byte
  // in the path used to silently truncate at the C boundary on legacy
  // libc — defense in depth even on modern Node).
  rejectNulAndControlChars(path, "path");
  rejectNulAndControlChars(base, "base");
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

  if (!isInside(resolved, baseResolved)) {
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

// T5.6 — top-level credential dot-dirs / dot-files. Matching against
// the FIRST path segment (lowercase). Adding any entry here costs a
// CHANGELOG note + an explicit case-fold test (entries are lowercased
// at module load).
const SENSITIVE_FIRST_SEGMENTS = new Set([
  ".ssh",
  ".aws",
  ".docker",
  ".kube",
  ".npmrc",
  ".netrc",
  ".pgpass",
]);

// T5.6 — credential basenames blocked at ANY depth (lowercase). Catches
// the developer-laptop case where an agent recurses into a subdir.
const SENSITIVE_BASENAMES = new Set([
  "id_rsa",
  "id_ed25519",
  "id_ecdsa",
  "id_dsa",
  "authorized_keys",
  "known_hosts",
  ".npmrc",
  ".netrc",
  ".pgpass",
]);

// T5.6 — extension suffixes blocked at ANY depth (lowercase). Covers
// the entire `*.pem` / `*.key` private-material family.
const SENSITIVE_SUFFIXES = [".pem", ".key", ".p12", ".pfx"];

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
  // T5.6 — lowercase normalization defeats case-only bypass on
  // case-insensitive filesystems (Windows/macOS-default) where `.ENV`
  // and `.env` map to the same inode but a case-sensitive string
  // check passes the former.
  const normalized = input.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
  if (normalized.length === 0) return false;

  const segments = normalized.split("/").filter((s) => s.length > 0);
  if (segments.length === 0) return false;

  if (isForbiddenFirstSegment(segments[0]!)) return true;
  if (isForbiddenBasename(segments[segments.length - 1]!)) return true;
  return false;
}

function isForbiddenFirstSegment(first: string): boolean {
  // .env.example is explicitly allowlisted (template safe to read)
  if (first === ".env.example") return false;
  if (first === ".env") return true;
  if (/^\.env\./.test(first)) return true;
  if (first === ".git" || first === "node_modules" || first === ".theo") return true;
  return SENSITIVE_FIRST_SEGMENTS.has(first);
}

function isForbiddenBasename(basename: string): boolean {
  if (LOCK_FILES.has(basename)) return true;
  if (SENSITIVE_BASENAMES.has(basename)) return true;
  for (const suffix of SENSITIVE_SUFFIXES) {
    if (basename.endsWith(suffix)) return true;
  }
  return false;
}

const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9\-_]*$/i;

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
 * Semver-exempt: reachable via the `@theokit/sdk/internal/security` sub-path, which the package
 * declares in `exports` but does NOT cover with its semver contract.
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

/**
 * Validate that `input` is a safe path component (skill name, agent ID,
 * namespace, etc.) and return its lowercase form. Strict grammar
 * `^[a-z0-9][a-z0-9-_]*$` rejects path separators, dots, null bytes,
 * whitespace, unicode invisible chars, and any leading `-`/`_`.
 *
 * TWO error classes leave this function, and the input decides which.
 * `PathTraversalError` EXTENDS `ConfigurationError`, so an `instanceof
 * ConfigurationError` test matches both and only `code` separates them — a
 * caller that branches on `code === "invalid_identifier"` alone rethrows the
 * traversal case, for exactly the bytes an attacker chooses:
 *
 *  - length 0, or above `maxLen` — `ConfigurationError`, code `invalid_identifier`.
 *  - a NUL (`0x00`), a C0 control char (`0x01`-`0x1f`) or DEL (`0x7f`) anywhere in
 *    `input` — `PathTraversalError`, code `path_traversal`. `rejectNulAndControlChars`
 *    runs BEFORE the grammar test, so it wins for any input carrying one of those bytes.
 *  - every other off-grammar input, a space and `/` and `..` and a leading `-` included —
 *    `ConfigurationError`, code `invalid_identifier`. Note a space is `0x20`, NOT a control
 *    char: `"agent /etc/passwd"` takes this branch, not the one above.
 *
 * The split itself is reported as usetheokit/theokit-sdk#368 — collapsing it is a behaviour
 * change on a published error class, so it is tracked there rather than made here.
 *
 * @param input - User-supplied identifier candidate.
 * @param options.maxLen - Maximum allowed length (default 64).
 * @returns Lowercase form of `input`.
 * @throws `PathTraversalError` with code `path_traversal` when `input` carries a NUL or
 *   control character; `ConfigurationError` with code `invalid_identifier` on every other
 *   rejection.
 */
export function sanitizeIdentifier(input: string, options?: { maxLen?: number }): string {
  const maxLen = options?.maxLen ?? 64;
  if (input.length === 0 || input.length > maxLen) {
    throw new ConfigurationError(`Identifier length out of range (1-${maxLen}): "${input}"`, {
      code: "invalid_identifier",
    });
  }
  // T5.5 — explicit NUL / control char rejection ahead of the generic
  // pattern check. The IDENTIFIER_PATTERN regex already excludes these
  // (they are not in `[a-z0-9\-_]`), but routing them through the same
  // helper used by safePathJoin gives operators a precise diagnostic
  // ("nul-byte" / "control-char-0x..") instead of the generic
  // "invalid characters" message — making prompt-injection traces
  // legible per Unbreakable Rule 3.
  rejectNulAndControlChars(input, "identifier");
  if (!IDENTIFIER_PATTERN.test(input)) {
    throw new ConfigurationError(`Identifier contains invalid characters: "${input}"`, {
      code: "invalid_identifier",
    });
  }
  return input.toLowerCase();
}

/**
 * Convert ANY opaque id (agent id, run id, conversation id, namespace, email,
 * arbitrary string) into a deterministic, filesystem-safe filename component.
 *
 * Unlike {@link sanitizeIdentifier} (which THROWS on non-conforming input),
 * this is a total function: it NEVER throws on a non-empty string. It returns
 * the lowercased id verbatim when it already matches the safe grammar
 * `^[a-z0-9][a-z0-9-_]*$` and fits `maxLen` (so UUIDs, hashes, and slugs stay
 * human-readable), otherwise a deterministic `h-<16 hex>` sha256 token
 * (collision-resistant and always a valid filename). The output charset is
 * always `[a-z0-9_-]`, safe as a literal path segment on every filesystem.
 *
 * @param id - any opaque identifier (must be a non-empty string)
 * @param options.maxLen - max length for the passthrough branch (default 128).
 *   Ids longer than this are hashed; the hash token itself is always short.
 * @throws ConfigurationError (code `invalid_filename_id`) only on empty input.
 *
 * @example
 *   safeFilenameForId("550e8400-e29b-41d4-a716-446655440000") // passthrough
 *   safeFilenameForId("user@example.com")                      // "h-<16hex>"
 *
 */
export function safeFilenameForId(id: string, options?: { maxLen?: number }): string {
  if (id.length === 0) {
    throw new ConfigurationError("Filename id must be a non-empty string", {
      code: "invalid_filename_id",
    });
  }
  const maxLen = options?.maxLen ?? 128;
  const lower = id.toLowerCase();
  if (lower.length <= maxLen && IDENTIFIER_PATTERN.test(lower)) {
    return lower;
  }
  return `h-${createHash("sha256").update(id).digest("hex").slice(0, 16)}`;
}
