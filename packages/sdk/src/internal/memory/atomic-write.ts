import { open, rename, unlink } from "node:fs/promises";

/**
 * Atomic file replacement: write content to `<path>.tmp`, fsync, then rename
 * over the target. Crash mid-write leaves either the old file intact or the
 * new file complete — never a half-written file.
 *
 * Mirrors OpenClaw's `replaceFileAtomic` from
 * `referencia/openclaw/packages/memory-host-sdk/src/host/fs-utils.ts`.
 *
 * @internal
 */
export async function replaceFileAtomic(filePath: string, content: string): Promise<void> {
  const tmp = `${filePath}.tmp`;
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
