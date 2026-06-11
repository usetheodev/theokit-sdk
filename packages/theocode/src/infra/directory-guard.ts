/**
 * `DirectoryGuard` — path-based access control.
 *
 * Blocks traversal outside project root via `..` segments and symlink escape.
 * Optionally allows extra approved directories.
 */

import { realpathSync } from "node:fs";
import { basename, resolve } from "node:path";

export class DirectoryGuard {
  private readonly root: string;
  private readonly approved: string[];

  constructor(projectRoot: string, extraApproved?: string[]) {
    this.root = resolve(projectRoot);
    this.approved = (extraApproved ?? []).map((p) => resolve(p));
  }

  /**
   * Returns true if the resolved real path is within project root
   * or one of the extra approved directories.
   */
  isAllowed(path: string): boolean {
    // Resolve the path relative to root first
    const resolved = resolve(this.root, path);

    // Resolve symlinks — if the real path escapes, deny
    let real: string;
    try {
      real = realpathSync(resolved);
    } catch {
      // Path doesn't exist — try resolving parent to catch symlink dirs
      try {
        const parent = resolve(resolved, "..");
        const realParent = realpathSync(parent);
        real = resolve(realParent, basename(resolved));
      } catch {
        real = resolved;
      }
    }

    // Check root
    if (real.startsWith(this.root + "/") || real === this.root) return true;

    // Check extra approved dirs
    for (const approved of this.approved) {
      if (real.startsWith(approved + "/") || real === approved) return true;
    }

    return false;
  }
}
