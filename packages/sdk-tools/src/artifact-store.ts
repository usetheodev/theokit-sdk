import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import { safeFilenameForId, safePathJoin } from "@theokit/sdk/path-safety";
import { replaceFileAtomic } from "@theokit/sdk/persistence";

/**
 * Options for {@link createSessionArtifactStore}.
 *
 * @public
 */
export interface SessionArtifactStoreOptions {
  /** Directory holding one file per artifact (`<dir>/<idStrategy(id)><extension>`). */
  dir: string;
  /**
   * Map an opaque artifact id to a filesystem-safe filename stem.
   * Default: `safeFilenameForId` (accepts ANY id; deterministically hashes
   * non-conforming input). The result is additionally passed through
   * `safePathJoin`, so a traversal id can never escape `dir`.
   *
   * NOTE — the default `safeFilenameForId` is CASE-FOLDING: ids differing only
   * in case (`"Run-1"` vs `"run-1"`) map to the SAME file. If your ids are
   * case-sensitive (e.g. base64), supply a case-preserving `idStrategy`.
   */
  idStrategy?: (id: string) => string;
  /** File extension (with leading dot). Default `".md"`. */
  extension?: string;
}

/**
 * A generic, id-keyed, atomic artifact store. Generalizes the per-run
 * session-summary writer pattern: persist an opaque text artifact under a
 * stable id, read it back, and enumerate what's stored.
 *
 * @public
 */
export interface SessionArtifactStore {
  /**
   * Write (overwrite) the artifact atomically; returns the resolved path.
   * Content is persisted byte-for-byte. The id is mapped via `idStrategy`
   * (default case-folding — see {@link SessionArtifactStoreOptions.idStrategy}).
   */
  write(id: string, content: string): Promise<string>;
  /** Read the artifact, or `undefined` if absent/unreadable (never throws). */
  read(id: string): Promise<string | undefined>;
  /** Whether an artifact exists for `id` (never throws). */
  has(id: string): Promise<boolean>;
  /** The filename stems of all stored artifacts (never throws; `[]` if dir absent). */
  list(): Promise<string[]>;
  /** The resolved, traversal-safe path for `id`. */
  path(id: string): string;
}

/**
 * Create a generic artifact store rooted at `dir`. Composes the shipped
 * `safeFilenameForId`/`safePathJoin` path guard + the atomic `replaceFileAtomic`
 * writer — zero new dependencies. Reads never throw; writes fail loud.
 *
 * @public
 */
export function createSessionArtifactStore(
  options: SessionArtifactStoreOptions,
): SessionArtifactStore {
  const { dir } = options;
  const idStrategy = options.idStrategy ?? ((id: string) => safeFilenameForId(id));
  const extension = options.extension ?? ".md";

  function path(id: string): string {
    return safePathJoin(dir, `${idStrategy(id)}${extension}`);
  }

  async function write(id: string, content: string): Promise<string> {
    const target = path(id);
    await mkdir(dir, { recursive: true });
    await replaceFileAtomic(target, content);
    return target;
  }

  async function read(id: string): Promise<string | undefined> {
    try {
      return await readFile(path(id), "utf8");
    } catch {
      return undefined;
    }
  }

  async function has(id: string): Promise<boolean> {
    // stat (not read) — O(1) existence check, no full-file load. Never throws.
    try {
      await stat(path(id));
      return true;
    } catch {
      return false;
    }
  }

  async function list(): Promise<string[]> {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return [];
    }
    return entries
      .filter((name) => name.endsWith(extension))
      .map((name) => name.slice(0, name.length - extension.length));
  }

  return { write, read, has, list, path };
}
