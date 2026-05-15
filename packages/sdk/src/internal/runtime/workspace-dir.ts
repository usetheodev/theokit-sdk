import { readdir } from "node:fs/promises";

import { ConfigurationError } from "../../errors.js";

/**
 * Entry returned by `readWorkspaceDir`. Mirrors the subset of
 * `fs.Dirent` the file-based loaders use.
 */
export interface WorkspaceDirEntry {
  name: string;
  isDirectory(): boolean;
  isFile(): boolean;
}

/**
 * Read a workspace subdirectory and return its entries. When the directory
 * does not exist (`ENOENT`), returns an empty array — the file-based loaders
 * (skills, plugins, agents) treat a missing directory as "no entries"
 * rather than an error.
 *
 * Any other I/O failure is wrapped as `ConfigurationError` so callers can
 * surface a stable error code.
 *
 * @internal
 */
export async function readWorkspaceDir(
  root: string,
  errorCode: string,
  describe: string,
): Promise<WorkspaceDirEntry[]> {
  try {
    return (await readdir(root, { withFileTypes: true })) as WorkspaceDirEntry[];
  } catch (cause) {
    const err = cause as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return [];
    throw new ConfigurationError(`Failed to read ${describe}: ${root}`, {
      code: errorCode,
      cause,
    });
  }
}
