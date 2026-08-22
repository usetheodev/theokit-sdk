/**
 * SQLite WAL mode helper with NFS/SMB/FUSE fallback to DELETE (ADR D63).
 *
 * WAL is faster (concurrent readers + one writer) but unsupported on some
 * network/FUSE filesystems. Try WAL; if the pragma returns something else
 * or throws, fall back to DELETE journal mode. Warn one time per label.
 *
 * This block is the MODULE header and must stay at offset 0. Sitting below the import it became a
 * leading comment of the first declaration instead, which is how its tag deleted `PragmaCapable`
 * from the emitted `.d.ts` while `applyWalWithFallback` — which names it — survived.
 */

import { diag } from "../diagnostics.js";

/**
 * The narrow slice of a SQLite handle this module needs: anything with a `pragma()` method, which
 * `better-sqlite3` satisfies without being named here.
 *
 * Not exported, but it appears in the signature of `applyWalWithFallback`, so it is emitted into
 * the published declarations and a consumer can structurally satisfy it.
 */
interface PragmaCapable {
  pragma: (statement: string, options?: { simple?: boolean }) => unknown;
}

/**
 * What journal mode a connection ended up in after `applyWalWithFallback`.
 *
 * `mode` is the mode actually in effect, never the one that was requested. `fellBack` is `true`
 * only when WAL was attempted and refused — either the pragma threw or it reported a mode other
 * than `wal` — and the connection was put into DELETE instead.
 *
 * `fellBack: true` is normal on NFS, SMB and FUSE, where WAL needs shared memory the filesystem
 * does not provide. It is not an error and nothing further is required of the caller; the
 * consequence is slower concurrent access, since DELETE mode does not allow readers alongside a
 * writer. Treat it as a signal about the storage, not about the database.
 *
 * @public — re-exported from the semver-protected `@theokit/sdk/persistence` barrel, and (for
 * back-compat) from the semver-exempt `@theokit/sdk/internal/persistence` alias.
 */
export interface WalApplyResult {
  /** Final journal_mode actually in effect. */
  mode: "wal" | "delete";
  /** True if we wanted WAL but the filesystem refused. */
  fellBack: boolean;
}

const warnedLabels = new Set<string>();

/**
 * Apply WAL mode with DELETE fallback. Idempotent — safe to call multiple
 * times on the same connection.
 *
 * @param db   any `pragma()`-capable SQLite handle (e.g., `better-sqlite3`)
 * @param label short identifier used in the warning (e.g., "memory-index")
 *
 */
export function applyWalWithFallback(db: PragmaCapable, label: string): WalApplyResult {
  try {
    const result = db.pragma("journal_mode = WAL", { simple: true });
    if (typeof result === "string" && result.toLowerCase() === "wal") {
      return { mode: "wal", fellBack: false };
    }
    logFallback(label, `got "${String(result)}" instead of "wal"`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logFallback(label, msg);
  }

  db.pragma("journal_mode = DELETE");
  return { mode: "delete", fellBack: true };
}

function logFallback(label: string, reason: string): void {
  if (warnedLabels.has(label)) return;
  warnedLabels.add(label);
  diag(
    `[theokit-sdk] ${label}: WAL unavailable (${reason}); using DELETE journal mode. ` +
      "This is normal on NFS/SMB/FUSE; expect slightly slower concurrent access.\n",
  );
}

/**
 * Test helper — clears the warn-once registry.
 *
 * @internal
 */
export function _resetWalWarnings(): void {
  warnedLabels.clear();
}
