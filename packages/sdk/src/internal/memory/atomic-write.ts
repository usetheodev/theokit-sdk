import { open, rename, unlink } from "node:fs/promises";

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
