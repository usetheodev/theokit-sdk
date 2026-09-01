import { TheokitAgentError } from "../errors.js";
/**
 * Filesystem backend protocol — a pluggable file *storage* provider for agent
 * tools, the storage-side twin of {@link SandboxBackend} (execution-side).
 *
 * SE31 (a peer framework Workspaces comparison). Mirrors `SandboxBackend`'s shape: a small
 * set of abstract methods (`readFile` / `writeFile` / `stat` / `list`) with
 * `exists()` derived on the base class, a boundary `basePath`, a `readOnly`
 * flag, and typed errors. Unlike `SandboxBackend` (whose file ops shell out via
 * `execute`, requiring command execution and giving NO structured `stat`), a
 * `FilesystemBackend` serves a *filesystem-only* workspace with no sandbox and
 * exposes a real `stat().mtimeMs` — the primitive SE32's read-before-write
 * safety compares against. See ADR 0011.
 *
 * New backends (S3, GCS, in-memory) implement the four abstract methods; higher
 * level helpers derive on the base. This is the backend *seam* — it does NOT
 * ship agent-facing tools nor a bundled workspace (bring-your-own-tools stands).
 *
 * @public
 */

/** Structured file metadata. `mtimeMs` is the read-before-write oracle (SE32). */
export interface FileStat {
  readonly size: number;
  readonly mtimeMs: number;
  readonly isFile: boolean;
  readonly isDirectory: boolean;
}

/** Options a write may carry. SE32 adds `expectedMtime` (stale-write guard). */
export interface WriteFileOptions {
  /**
   * SE32 — when set, the write fails with {@link StaleFileError} if the file's
   * current `mtimeMs` differs (someone changed it since it was last read).
   */
  readonly expectedMtime?: number;
}

/**
 * Construction options shared by every {@link FilesystemBackend}.
 *
 * `basePath` is resolved ONCE, at construction, and defaults to `process.cwd()`. Omitting it does
 * not mean "no boundary" — it means the boundary is wherever the process happened to be standing,
 * which is rarely what the caller intended and never what a reviewer can verify. Pass it explicitly.
 *
 * The boundary rejects lexical traversal AND symlink escape, raising
 * {@link FilesystemSecurityError}. It is a boundary, not a sandbox: it constrains paths this
 * backend resolves, and constrains nothing else the process can do. For untrusted code, run it in a
 * container or VM.
 */
export interface FilesystemConfig {
  /** Boundary root. Every path is resolved within it; escapes are rejected. */
  readonly basePath?: string;
  /** When true, every write throws {@link FilesystemReadOnlyError}. */
  readonly readOnly?: boolean;
}

/** A path escaped the backend's `basePath` (traversal or symlink). */
export class FilesystemSecurityError extends TheokitAgentError {
  override readonly name = "FilesystemSecurityError";
  override readonly code = "filesystem_security" as const;
  constructor(message: string) {
    // not retryable: a path outside the root stays outside it
    super(message, { code: "filesystem_security", isRetryable: false });
  }
}

/** A write was attempted on a read-only backend. */
export class FilesystemReadOnlyError extends TheokitAgentError {
  override readonly name = "FilesystemReadOnlyError";
  override readonly code = "filesystem_readonly" as const;
  constructor(message: string) {
    // not retryable: the backend does not become writable
    super(message, { code: "filesystem_readonly", isRetryable: false });
  }
}

/** A read/stat targeted a path that does not exist. */
export class FileNotFoundError extends TheokitAgentError {
  override readonly name = "FileNotFoundError";
  override readonly code = "filesystem_not_found" as const;
  constructor(public readonly path: string) {
    // not retryable: a missing file is a fact about the request, not a transient condition
    super(`File not found: ${path}`, { code: "filesystem_not_found", isRetryable: false });
  }
}

/**
 * A filesystem I/O operation failed for a reason other than not-found /
 * read-only / stale / security (e.g. `ENOTDIR` — a path component is a file, or
 * `EACCES` / `ENOSPC`). Carries the original error as `cause` so no raw,
 * untyped Node `SystemError` ever escapes the backend (Unbreakable Rule 8).
 */
export class FilesystemError extends TheokitAgentError {
  override readonly name = "FilesystemError";
  override readonly code = "filesystem_io" as const;
  constructor(
    public readonly path: string,
    cause: unknown,
  ) {
    // retryable: a lower-level I/O failure CAN be transient — EBUSY, EAGAIN, a full disk that frees
    super(
      `Filesystem operation failed on "${path}": ${(cause as { message?: string })?.message ?? cause}`,
      { cause, code: "filesystem_io", isRetryable: true },
    );
  }
}

/**
 * SE32 — a write's `expectedMtime` did not match the file's current mtime: the
 * file changed since it was last read, so the write would silently clobber.
 */
export class StaleFileError extends TheokitAgentError {
  override readonly name = "StaleFileError";
  override readonly code = "filesystem_stale" as const;
  constructor(
    public readonly path: string,
    public readonly expectedMtime: number,
    public readonly actualMtime: number,
  ) {
    // not retryable: the caller must re-read first; retrying the same write reproduces the conflict
    super(
      `Stale write to "${path}": expected mtime ${expectedMtime}, found ${actualMtime} ` +
        `(file changed since last read — re-read before writing)`,
      { code: "filesystem_stale", isRetryable: false },
    );
  }
}

/**
 * Pluggable filesystem backend. Implement the four abstract methods; `exists()`
 * and the `readOnly`/`basePath` accessors derive on the base class.
 *
 * @public
 */
export abstract class FilesystemBackend {
  protected readonly _basePath: string;
  protected readonly _readOnly: boolean;

  constructor(config: FilesystemConfig = {}) {
    this._basePath = config.basePath ?? process.cwd();
    this._readOnly = config.readOnly ?? false;
  }

  /** Read a boundary-relative file as UTF-8. Throws {@link FileNotFoundError}. */
  abstract readFile(path: string): Promise<string>;

  /**
   * Write UTF-8 content to a boundary-relative path (creating parents). Returns
   * the new {@link FileStat}. Throws {@link FilesystemReadOnlyError} on a
   * read-only backend and {@link StaleFileError} when `opts.expectedMtime`
   * mismatches (SE32).
   */
  abstract writeFile(path: string, content: string, opts?: WriteFileOptions): Promise<FileStat>;

  /** Structured metadata for a path. Throws {@link FileNotFoundError}. */
  abstract stat(path: string): Promise<FileStat>;

  /** Directory entry names (not recursive). Throws {@link FileNotFoundError}. */
  abstract list(path: string): Promise<string[]>;

  /** Derived — true iff `stat(path)` resolves (absent ⇒ false). */
  async exists(path: string): Promise<boolean> {
    try {
      await this.stat(path);
      return true;
    } catch (err) {
      if (err instanceof FileNotFoundError) return false;
      throw err;
    }
  }

  /** Throw {@link FilesystemReadOnlyError} when the backend is read-only. */
  protected assertWritable(): void {
    if (this._readOnly) {
      throw new FilesystemReadOnlyError(`Filesystem is read-only (basePath: ${this._basePath})`);
    }
  }

  get readOnly(): boolean {
    return this._readOnly;
  }

  get basePath(): string {
    return this._basePath;
  }
}

/**
 * A backend OR a per-request resolver of one. A resolver runs at tool-execution
 * time (the request scope), so multi-tenant / multi-role agents get a distinct
 * root or permission set per request without a shared mutable backend.
 *
 * @public
 */
export type FilesystemProvider<Ctx = unknown> =
  | FilesystemBackend
  | ((ctx: Ctx) => FilesystemBackend | Promise<FilesystemBackend>);

/** Resolve a {@link FilesystemProvider} to a concrete backend for `ctx`. */
export async function resolveFilesystem<Ctx>(
  provider: FilesystemProvider<Ctx>,
  ctx: Ctx,
): Promise<FilesystemBackend> {
  return provider instanceof FilesystemBackend ? provider : provider(ctx);
}
