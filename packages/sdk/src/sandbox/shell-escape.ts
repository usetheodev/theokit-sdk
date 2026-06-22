/**
 * POSIX shell escaping for values interpolated into a `SandboxBackend.execute`
 * command string. `execute` runs via `/bin/sh -c`, so any untrusted value
 * (repo URL, ref, path) MUST be quoted to prevent command injection.
 *
 * @internal
 */

/** Wrap `arg` in single quotes, escaping embedded single quotes (`'\''`). */
export function shellEscapePosix(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}
