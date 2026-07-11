/**
 * `ReadTracker` — SE32 read-before-write safety.
 *
 * A per-run map of `path → mtimeMs` recorded whenever the read tool reads a
 * file. The write tool (with `requireReadBeforeWrite` on) consults it before an
 * overwrite: a file that was never read, or that changed on disk since it was
 * read, is refused instead of silently clobbered. Scope one tracker per run /
 * session — it is deliberately NOT a global singleton (no cross-run leak).
 *
 * @public
 */
export class ReadTracker {
  private readonly seen = new Map<string, number>();

  /** Record the mtime observed when `path` was read. */
  record(path: string, mtimeMs: number): void {
    this.seen.set(path, mtimeMs);
  }

  /** The mtime last recorded for `path`, or `undefined` if never read. */
  expected(path: string): number | undefined {
    return this.seen.get(path);
  }
}

/** The verdict of a read-before-write check for one write (internal). */
type WriteDecision = "ok" | "read_required" | "stale";

/**
 * Decide whether a write to `path` is allowed, given the file's CURRENT on-disk
 * mtime (`null` ⇒ the file does not exist yet). Pure — no I/O.
 *
 * - absent file        → `ok`            (a new file cannot clobber anything)
 * - present, unread    → `read_required` (must read before a blind overwrite)
 * - present, changed   → `stale`         (mtime differs from the read snapshot)
 * - present, unchanged → `ok`
 */
export function evaluateReadBeforeWrite(
  tracker: ReadTracker,
  path: string,
  currentMtimeMs: number | null,
): WriteDecision {
  if (currentMtimeMs === null) return "ok";
  const recorded = tracker.expected(path);
  if (recorded === undefined) return "read_required";
  if (recorded !== currentMtimeMs) return "stale";
  return "ok";
}
