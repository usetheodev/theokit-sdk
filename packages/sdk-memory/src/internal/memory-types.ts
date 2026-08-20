/**
 * Public memory types (used by runtime + storage + migration + future index).
 *
 * Leaf module — depends only on `node:path` + the public
 * `@theokit/sdk/path-safety` re-exports (`safePathJoin`,
 * `sanitizeIdentifier`) + `@theokit/sdk`'s `Security` for the
 * canonical `redactSecrets` 12-pattern list (ADR D68).
 *
 * Iter 52 (Stage 3 source-move #9): hybrid copy from sdk-core's
 * `internal/memory/types.ts`. sdk-core retains its copy for v1.x
 * back-compat; sdk-memory ships the canonical copy that future
 * `storage/*`, `migration`, and `tools` moves will target as siblings.
 *
 * **Sub-path-import contract:** sdk-core copy imports
 * `safePathJoin`/`sanitizeIdentifier` from `../security/path-guard.js`
 * (internal path); sdk-memory copy imports them from
 * `@theokit/sdk/path-safety` (public sub-path stable per this
 * iter — sanitizeIdentifier was promoted to the public surface to
 * unblock this move). Same runtime, same grammar.
 *
 * @internal
 */
import { resolve as resolvePath } from "node:path";

import { Security } from "@theokit/sdk";
import { safePathJoin, sanitizeIdentifier } from "@theokit/sdk/path-safety";

/**
 * Per-agent memory configuration. `enabled` gates the configuration-aware
 * accessors (`readFacts`, `appendFact`) — with it `false` they resolve without
 * touching disk, while the lower-level markdown functions ignore it.
 *
 * `namespace`, `scope` and `userId` are only consulted for the legacy JSON path
 * (see {@link legacyMemoryJsonPath}); the markdown store keeps one `MEMORY.md`
 * per workspace and does not partition by them. They are treated as
 * user-supplied and sanitised before they reach a path. `storePath` is treated
 * as trusted and resolved as given.
 */
export interface MemoryConfig {
  enabled: boolean;
  namespace?: string;
  userId?: string;
  scope?: "agent" | "user" | "team";
  storePath?: string;
}

/**
 * One remembered statement. `text` is what gets written, embedded and searched;
 * it passes through secret redaction on the way to disk, so what is stored may
 * differ from what was passed in.
 */
export interface MemoryFact {
  text: string;
  /**
   * Optional taxonomy bucket (M4-3). Backward-compatible — flat-store facts
   * omit it; the categorized store (`createCategorizedMemory`) always sets it.
   */
  category?: string;
}

/**
 * Canonical credential-redaction primitive (ADR D68).
 *
 * sdk-core's copy re-exports `redactSecrets` directly from
 * `../security/index.js` (internal path). sdk-core's PUBLIC surface
 * (`@theokit/sdk`) doesn't expose a bare `redactSecrets` symbol —
 * it ships `Security.redact()` instead (T2.1, by design — the
 * namespace also carries `Security.addPattern()`). sdk-memory's
 * canonical `redactSecrets` re-export wraps `Security.redact` 1-to-1
 * so consumers continue to see the same symbol name without sdk-memory
 * having to import sdk-core's internal subpath. Same 12-pattern
 * list, same two-bucket mask shape, same disable-via-env behavior.
 */
export function redactSecrets(text: unknown, opts?: { codeFile?: boolean }): string {
  return Security.redact(text, opts);
}

/**
 * Resolve the legacy JSON memory path used pre-ADR-D8 (kept for migration
 * helpers + tests). Centralized here so `migration.ts` and the legacy-aware
 * `runtime/memory-store.ts` don't duplicate the path logic (jscpd cleanup).
 */
export function legacyMemoryJsonPath(cwd: string, config: MemoryConfig): string {
  // ADRs D79-D81: storePath is programmatic (trusted); namespace/scope/userId
  // are user-shaped and pass sanitizeIdentifier. EC-7 (edge-case review):
  // realistic userIds (UUIDs, hash IDs, "default") pass; "user@example.com"
  // and similar need to be normalized by the caller before passing.
  if (config.storePath !== undefined) {
    return resolvePath(cwd, config.storePath);
  }
  const namespace = sanitizeIdentifier(config.namespace ?? "default");
  const scope = sanitizeIdentifier(config.scope ?? "agent", { maxLen: 16 });
  const userId = sanitizeIdentifier(config.userId ?? "default");
  return safePathJoin(cwd, ".theokit", "memory", namespace, `${scope}-${userId}.json`);
}

/**
 * A semantically meaningful slice of a markdown memory file, produced by
 * `chunkMarkdown`. Each chunk carries stable line numbers + a content hash
 * used downstream by the embedding cache.
 *
 * Mirrors peer-project's `MemoryChunk` shape
 * (`reference/peer-project/packages/memory-host-sdk/src/host/engine-storage.ts`).
 *
 * @internal
 */
export interface MemoryChunk {
  /** 1-indexed starting line in the source file. */
  startLine: number;
  /** 1-indexed ending line (inclusive). */
  endLine: number;
  /** Slice of markdown source text. */
  text: string;
  /** sha256 of `text`; stable across runs for identical inputs. */
  hash: string;
  /** Optional nearest heading text (without the `#` markers). */
  heading?: string;
}

/**
 * Result of `reader.readFile`. Contains the bounded slice plus truncation
 * + provenance info.
 *
 * Mirrors peer-project's `MemoryReadResult` shape.
 *
 * @internal
 */
export interface MemoryReadResult {
  path: string;
  /** Requested starting line (1-indexed, defaults to 1). */
  from: number;
  /** Number of lines actually returned (may be less than `lines` near EOF). */
  linesReturned: number;
  /** Total lines in the file (after the read). */
  totalLines: number;
  /** True when content remains after the returned slice, i.e. `remainingLines > 0`. */
  truncated: boolean;
  /** Lines past the returned slice that remain in the file. */
  remainingLines: number;
  /** Slice text (joined with `\n`). */
  text: string;
}

/**
 * Lightweight reference to a markdown file in the memory corpus.
 *
 * Mirrors peer-project's `MemoryFileEntry`.
 *
 * @internal
 */
export interface MemoryFileEntry {
  /** Absolute path on disk. */
  path: string;
  /** Path relative to the memory root (e.g. "MEMORY.md", "notes/foo.md"). */
  relPath: string;
  /** ms-since-epoch mtime. */
  mtime: number;
  /** sha256 of the file content; recomputed on each read. */
  hash: string;
}
