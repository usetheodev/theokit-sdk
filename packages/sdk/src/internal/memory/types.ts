/**
 * Public memory types (used by runtime + storage + migration + future index).
 *
 * Leaf module — only depends on `node:path` — so neither `runtime/memory-store.ts`
 * nor `internal/memory/markdown-store.ts` introduces a dependency cycle.
 *
 * @internal
 */
import { join, resolve as resolvePath } from "node:path";

export interface MemoryConfig {
  enabled: boolean;
  namespace?: string;
  userId?: string;
  scope?: "agent" | "user" | "team";
  storePath?: string;
}

export interface MemoryFact {
  text: string;
}

const SECRET_PATTERN = /\b(?:sk-proj-[A-Za-z0-9-]+|ghp_[A-Za-z0-9-]+|sk-[A-Za-z0-9-]+)\b/g;

export function redactSecrets(text: string): string {
  return text.replace(SECRET_PATTERN, "***");
}

/**
 * Resolve the legacy JSON memory path used pre-ADR-D8 (kept for migration
 * helpers + tests). Centralized here so `migration.ts` and the legacy-aware
 * `runtime/memory-store.ts` don't duplicate the path logic (jscpd cleanup).
 */
export function legacyMemoryJsonPath(cwd: string, config: MemoryConfig): string {
  const namespace = config.namespace ?? "default";
  const scope = config.scope ?? "agent";
  const userId = config.userId ?? "default";
  const relativePath =
    config.storePath ?? join(".theokit", "memory", namespace, `${scope}-${userId}.json`);
  return resolvePath(cwd, relativePath);
}

/**
 * A semantically meaningful slice of a markdown memory file, produced by
 * `chunkMarkdown`. Each chunk carries stable line numbers + a content hash
 * used downstream by the embedding cache.
 *
 * Mirrors OpenClaw's `MemoryChunk` shape
 * (`referencia/openclaw/packages/memory-host-sdk/src/host/engine-storage.ts`).
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
 * Mirrors OpenClaw's `MemoryReadResult` shape.
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

/**
 * Lightweight reference to a markdown file in the memory corpus.
 *
 * Mirrors OpenClaw's `MemoryFileEntry`.
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
