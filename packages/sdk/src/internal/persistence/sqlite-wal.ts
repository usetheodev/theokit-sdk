/**
 * SQLite WAL mode helper with NFS/SMB/FUSE fallback to DELETE (ADR D63).
 *
 * WAL is faster (concurrent readers + one writer) but unsupported on some
 * network/FUSE filesystems. Try WAL; if the pragma returns something else
 * or throws, fall back to DELETE journal mode. Warn one time per label.
 *
 * @internal
 */

interface PragmaCapable {
  pragma: (statement: string, options?: { simple?: boolean }) => unknown;
}

/**
 * Result of `applyWalWithFallback`.
 *
 * @internal
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
 * @internal
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
  process.stderr.write(
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
