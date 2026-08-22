/**
 * LocalFilesystem — a {@link FilesystemBackend} over the local process
 * filesystem (`node:fs/promises`), boundary-enforced against `basePath`.
 *
 * **This is NOT an isolation boundary** (same OS, same user). Its safety
 * affordances are path-boundary enforcement (traversal + symlink escape,
 * reusing the core `internal/security/path-guard` primitives) and the optional
 * `readOnly` flag. For untrusted code, run it inside a container/VM sandbox.
 *
 * The check-then-use gap between `assertNoSymlinkEscape` and the subsequent
 * `fs` call is a known TOCTOU: a local attacker could atomically swap an
 * in-boundary symlink after the check. Closing it needs `O_NOFOLLOW`, which
 * Node's `fs/promises` does not expose — accepted for same-user local contexts.
 *
 * SE31 (a peer framework Workspaces comparison). See ADR 0011.
 *
 * @public
 */

import {
  readFile as fsReadFile,
  stat as fsStat,
  writeFile as fsWriteFile,
  mkdir,
  readdir,
} from "node:fs/promises";
import { dirname } from "node:path";

import {
  assertNoSymlinkEscape,
  PathTraversalError,
  safePathJoin,
} from "../internal/security/path-guard.js";
import {
  FileNotFoundError,
  type FileStat,
  FilesystemBackend,
  type FilesystemConfig,
  FilesystemError,
  FilesystemSecurityError,
  StaleFileError,
  type WriteFileOptions,
} from "./types.js";

/**
 * {@link FilesystemBackend} over the real filesystem (`node:fs/promises`), with every path resolved
 * inside `basePath` and escapes rejected.
 *
 * ```ts
 * const fs = new LocalFilesystem({ basePath: "/srv/workspace", readOnly: false });
 * await fs.writeFile("notes/today.md", "hello");   // /srv/workspace/notes/today.md
 * await fs.readFile("../../etc/passwd");           // FilesystemSecurityError
 * ```
 *
 * Two things a caller gets wrong. First, the default `basePath` is `process.cwd()` — see
 * {@link FilesystemConfig}. Second, the security boundary is checked BEFORE the read-only flag, on
 * purpose: a traversal path against a read-only backend reports the security error, not the
 * read-only one, so the more serious condition is the one you see.
 *
 * Errors are normalised — a missing file, a stale `expectedMtime`, a boundary escape and a write to
 * a read-only backend each raise their own typed error rather than a raw `ENOENT`-shaped one.
 */
export class LocalFilesystem extends FilesystemBackend {
  constructor(config: FilesystemConfig = {}) {
    super(config);
  }

  async readFile(path: string): Promise<string> {
    const abs = this.resolve(path);
    try {
      return await fsReadFile(abs, "utf-8");
    } catch (err) {
      throw this.mapError(err, path);
    }
  }

  async writeFile(path: string, content: string, opts?: WriteFileOptions): Promise<FileStat> {
    // Security boundary FIRST (a traversal path on a read-only backend must
    // report the security error, not the read-only one — fail-clear).
    const abs = this.resolve(path);
    this.assertWritable();
    // SE32 — stale-write guard: if the caller passed the mtime it last read,
    // reject when the file changed underneath it (never a silent clobber).
    if (opts?.expectedMtime !== undefined) {
      await this.assertNotStale(path, abs, opts.expectedMtime);
    }
    try {
      await mkdir(dirname(abs), { recursive: true });
      await fsWriteFile(abs, content, "utf-8");
    } catch (err) {
      throw this.mapError(err, path);
    }
    return this.statAbs(abs, path);
  }

  async stat(path: string): Promise<FileStat> {
    const abs = this.resolve(path);
    return this.statAbs(abs, path);
  }

  async list(path: string): Promise<string[]> {
    const abs = this.resolve(path);
    try {
      return await readdir(abs);
    } catch (err) {
      throw this.mapError(err, path);
    }
  }

  private async statAbs(abs: string, relPath: string): Promise<FileStat> {
    try {
      const s = await fsStat(abs);
      return {
        size: s.size,
        mtimeMs: s.mtimeMs,
        isFile: s.isFile(),
        isDirectory: s.isDirectory(),
      };
    } catch (err) {
      throw this.mapError(err, relPath);
    }
  }

  /** SE32 — compare the on-disk mtime against the caller's expected value. */
  private async assertNotStale(relPath: string, abs: string, expectedMtime: number): Promise<void> {
    let current: number | undefined;
    try {
      current = (await fsStat(abs)).mtimeMs;
    } catch (err) {
      // A brand-new file (does not exist yet) cannot be stale — allow the write.
      if ((err as { code?: string }).code === "ENOENT") return;
      throw this.mapError(err, relPath);
    }
    if (current !== expectedMtime) {
      throw new StaleFileError(relPath, expectedMtime, current);
    }
  }

  /**
   * Resolve a boundary-relative path to an absolute one, rejecting lexical
   * traversal (`..`, absolute, NUL) and symlink escape — both reusing the core
   * path-guard primitives, remapped to {@link FilesystemSecurityError}.
   */
  private resolve(path: string): string {
    let abs: string;
    try {
      abs = safePathJoin(this._basePath, path);
    } catch (err) {
      if (err instanceof PathTraversalError) {
        throw new FilesystemSecurityError(`Path escapes basePath: ${path}`);
      }
      throw err;
    }
    try {
      assertNoSymlinkEscape(abs, this._basePath);
    } catch (err) {
      if (err instanceof PathTraversalError) {
        throw new FilesystemSecurityError(`Path escapes basePath via symlink: ${path}`);
      }
      throw err;
    }
    return abs;
  }

  private mapError(err: unknown, path: string): Error {
    if (
      err instanceof FilesystemSecurityError ||
      err instanceof FilesystemError ||
      err instanceof FileNotFoundError ||
      err instanceof StaleFileError
    ) {
      return err;
    }
    if ((err as { code?: string }).code === "ENOENT") return new FileNotFoundError(path);
    // ENOTDIR (a path component is a file), EACCES, ENOSPC, … — never leak a
    // raw untyped Node SystemError (Rule 8); wrap with the original as cause.
    return new FilesystemError(path, err);
  }
}
