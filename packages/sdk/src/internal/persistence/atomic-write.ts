import { mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Atomic file replacement: write content to a per-call unique tmp path,
 * fsync, then rename over the target. Crash mid-write leaves either the old
 * file intact or the new file complete — never a half-written file.
 *
 * The tmp suffix is `<pid>.<rand>.tmp` so parallel processes (and concurrent
 * burst writes within one process) never collide on the same tmp path — a
 * race that would manifest as `ENOENT` on `rename` after the rival process
 * already moved its tmp into place.
 *
 * Mirrors OpenClaw's `replaceFileAtomic` from
 * `referencia/openclaw/packages/memory-host-sdk/src/host/fs-utils.ts` with
 * the multi-writer robustness fix.
 *
 * @internal
 */
export async function replaceFileAtomic(filePath: string, content: string): Promise<void> {
  const tmp = `${filePath}.${process.pid}.${Math.random().toString(36).slice(2, 10)}.tmp`;
  const handle = await open(tmp, "w");
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(tmp, filePath);
  } catch (cause) {
    // Cleanup tmp on rename failure so we don't leak stale .tmp files.
    await unlink(tmp).catch(() => undefined);
    throw cause;
  }
}

/**
 * Options for `atomicWriteJson`.
 *
 * @internal
 */
export interface AtomicWriteJsonOptions {
  /** Indent passed to `JSON.stringify`. Default: 2. */
  indent?: number;
  /** Whether to append a trailing newline (POSIX convention). Default: true. */
  trailingNewline?: boolean;
}

/**
 * Typed JSON atomic write helper.
 *
 * Serializes `data` to JSON, then delegates to `replaceFileAtomic`. The
 * parent directory is auto-created (recursive `mkdir`) to make this helper
 * safe for callers who haven't ensured the directory exists (EC-4 in the
 * persistence-state-hardening plan).
 *
 * Throws `TypeError` on circular refs or `undefined` data (propagates from
 * `JSON.stringify`).
 *
 * @internal
 */
export async function atomicWriteJson<T>(
  filePath: string,
  data: T,
  options?: AtomicWriteJsonOptions,
): Promise<void> {
  const indent = options?.indent ?? 2;
  const trailingNewline = options?.trailingNewline ?? true;
  const json = JSON.stringify(data, null, indent);
  if (json === undefined) {
    throw new TypeError("atomicWriteJson: cannot serialize undefined");
  }
  const content = trailingNewline ? `${json}\n` : json;
  await mkdir(dirname(filePath), { recursive: true });
  await replaceFileAtomic(filePath, content);
}

/**
 * Atomic text write. Same crash-safety guarantees as `replaceFileAtomic` +
 * auto-mkdir of the parent directory. Used by `theokit-migrate-config`
 * (T4.1, EC-2 MUST FIX) so a crash mid-migration leaves previous MD files
 * intact rather than corrupting them.
 *
 * @internal
 */
export async function atomicWriteText(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await replaceFileAtomic(filePath, content);
}
