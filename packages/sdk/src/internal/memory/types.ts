/**
 * Public memory types (used by runtime + storage + migration + future index).
 *
 * Leaf module — only depends on `node:path` — so neither `runtime/memory-store.ts`
 * nor `internal/memory/markdown-store.ts` introduces a dependency cycle.
 *
 * @internal
 */
import { resolve as resolvePath } from "node:path";

import { safePathJoin, sanitizeIdentifier } from "../security/path-guard.js";

export interface MemoryConfig {
  enabled: boolean;
  namespace?: string;
  userId?: string;
  scope?: "agent" | "user" | "team";
  storePath?: string;
}

/**
 * What a fact IS, which is what decides whether it ages (#389).
 *
 * The four are the distinctions that matter for retention and recall: a preference stays true until
 * the user changes their mind, a project fact goes stale when the code moves, a reference either
 * resolves or 404s, and feedback records a correction that was given. Without them, recall ranks one
 * undifferentiated corpus and pruning has no basis to prefer a durable fact over a transient one.
 *
 * A kind is never INFERRED. A wrong kind is worse than none, because it makes retention and recall
 * confident about the wrong thing — so a fact whose author did not say stays untyped.
 *
 * Four, not more, and deliberately: a wider vocabulary exists to drive differentiated retention, and
 * there is no retention here to differentiate. See `packages/sdk/docs/memory-decisions.md` § 2.
 */
export type MemoryKind = "user" | "feedback" | "project" | "reference";

/** The four values {@link MemoryKind} admits, for runtime validation at the storage boundary. */
export const MEMORY_KINDS: readonly MemoryKind[] = ["user", "feedback", "project", "reference"];

export interface MemoryFact {
  text: string;
  /**
   * What this fact is (#389). Absent means untyped, which is what a hand-written bullet under
   * `## Facts` stays — those files are already on disk in consumers' repositories and the store's
   * own header invites editing them.
   */
  kind?: MemoryKind;
  /**
   * ISO 8601 instant this fact was last written, stamped BY THE SDK.
   *
   * Supplying it does nothing: a timestamp a caller can set is a timestamp that can lie about when
   * something was learned, and the whole point is to weigh a note from this morning against one
   * from four months ago. Absent on a fact written before this existed, or hand-added.
   */
  modified?: string;
}

// `redactSecrets` is now re-exported from the canonical security module
// (ADR D68). Pre-T0.2 it was a 3-pattern local fn; consolidated to avoid
// drift with the central 12-pattern list.
export { redactSecrets } from "../security/index.js";

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
  /** True when fewer lines were returned than the requested `lines` AND EOF was hit. */
  truncated: boolean;
  /** Lines past the returned slice that remain in the file. */
  remainingLines: number;
  /** Slice text (joined with `\n`). */
  text: string;
}
