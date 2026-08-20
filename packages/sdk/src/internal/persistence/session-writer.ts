/**
 * M81 — single-writer lease for a session transcript.
 *
 * ## The problem
 *
 * Nothing stops two processes appending to the same JSONL transcript. The concrete case: `exec
 * resume --last` can write into the TUI's live session. Two interleaved appends to an append-only
 * file produce lines that are each individually valid and whose SEQUENCE is fiction — and nothing
 * reports it, because every line parses.
 *
 * ## Why an exclusive lockfile rather than `withFileLock`
 *
 * The plan's ADR D2 said to compose `withFileLock`, and that was the right instinct — do not build a
 * second lock mechanism. It turned out not to fit the SHAPE: `withFileLock(path, fn)` is
 * scope-based — it holds the lock for the duration of a callback. A session lease is **held across
 * turns**, for as long as the process owns the session, with an explicit `release()`. Wrapping the
 * whole session lifetime in a callback would invert control of the entire agent loop.
 *
 * So this uses the same underlying primitive `withFileLock` uses (an exclusive-create lockfile,
 * `wx`) with lease semantics on top. That keeps the mechanism single — the file-existence lock —
 * while giving it the lifetime the caller needs. The deviation from D2 is recorded here because the
 * plan's rationale (no second mechanism) still holds; only its shape assumption did not.
 *
 * ## Fail fast, never wait
 *
 * A second writer that WAITED would block `exec` behind a TUI session that can last hours. The typed
 * error lets the caller choose: fork to a new id, or give up with a real diagnosis.
 *
 * @internal
 */

import {
  closeSync,
  existsSync,
  fchmodSync,
  openSync,
  readFileSync,
  rmSync,
  writeSync,
} from "node:fs";
import { hostname } from "node:os";

import { TheokitAgentError } from "../../errors.js";

/**
 * M81 — another process already holds the writer lease for this session.
 *
 * Carries `sessionPath` because knowing WHICH session is busy is what lets the caller decide between
 * forking and waiting for the user to close the TUI (`rules/error-handling.md § 2` — context enough
 * to act on).
 */
export class SessionBusyError extends TheokitAgentError {
  override readonly name = "SessionBusyError";

  constructor(readonly sessionPath: string) {
    super(
      `another process is already writing this session: ${sessionPath}. ` +
        "Fork it to a new id instead of appending — two writers interleave lines into a sequence " +
        "that parses but is not what either process wrote.",
      { code: "session_busy", isRetryable: false },
    );
  }
}

/** A held writer lease. `release()` is idempotent. */
export interface SessionWriterLease {
  readonly sessionPath: string;
  release(): Promise<void>;
  /**
   * Re-stamp the ownership record, so a **live** owner never crosses the staleness window.
   *
   * Idempotent and cheap: one `write` of a ~80-byte JSON. Call it on the path that already writes to
   * the session — appending a turn — and the cross-host window stops being a lie about liveness.
   *
   * A no-op after `release()`: renewing a lease you no longer hold would re-create the lock file and
   * hand this process ownership it gave up. That is the one direction of this API that could
   * *create* the double-writer it exists to prevent.
   */
  renew(): void;
}

/**
 * Staleness window **between machines** — and only between them.
 *
 * 30 s from ACQUISITION. Calling it a "heartbeat" would be a lie: the record is written once, when
 * the lease is taken, and is **not** renewed on every write. An earlier version of this comment
 * claimed "the owner touches the file on every acquisition, so a live process never crosses the
 * window" — false twice over, and adversarial review measured both.
 *
 * On the **same host** this does not matter: `reclaimable` decides by `pid`, which is exact, and age
 * never enters the calculation. Across hosts it does matter, and it is a real limit: a **live**
 * remote owner loses the lease after 30 s, because there is no way to ask another machine whether
 * its process still exists.
 *
 * **The residue is now closable by the caller** (`agent-builder#118`). `SessionWriterLease.renew()`
 * re-stamps the record; calling it on the path that already writes to the session — appending a turn
 * — keeps a live owner from ever crossing the window. It costs one `write` of ~80 bytes on a file
 * that was previously written once per session.
 *
 * It is `renew()` and not an internal timer on purpose. A timer inside the lease would keep the event
 * loop alive (or need `unref` plus its own teardown), and it would renew a lease belonging to a
 * process that is hung rather than working — which is precisely the state the window exists to
 * detect. Tying the renewal to a real write means the record tracks **progress**, not mere existence.
 */
export const HEARTBEAT_WINDOW_MS = 30_000;

/** Who holds the lock. Written as JSON into `.writer.lock`. */
interface LockOwner {
  pid: number;
  hostname: string;
  mtime: number;
}

/** The ownership record for THIS process, stamped now. One place, so acquire and renew cannot drift. */
function ownerNow(): LockOwner {
  return { pid: process.pid, hostname: hostname(), mtime: Date.now() };
}

/**
 * Writes the owner with user-only permissions.
 *
 * `0600` because the lock is an assertion of OWNERSHIP: with the `0664` the usual umask produces,
 * another user in the same group can overwrite the file and forge ownership of the session — and
 * from then on it is the legitimate owner who starts receiving `SessionBusyError`. The content
 * (`pid`, `hostname`) is low-sensitivity; what the permission protects is the signal's
 * **integrity**, not its secrecy.
 */
function writeOwner(lockPath: string, owner: LockOwner): void {
  const fd = openSync(lockPath, "w", 0o600);
  try {
    writeSync(fd, JSON.stringify(owner));
    // `open`'s `mode` only applies on CREATION. A `.writer.lock` inherited from an earlier version —
    // or left behind by a process with a different umask — would stay `0664` after being reclaimed,
    // and the forgery window the mode closes for new locks would remain open for old ones.
    fchmodSync(fd, 0o600);
  } finally {
    closeSync(fd);
  }
}

/** Reads the lock's owner. `undefined` when the file vanished or the content is unreadable. */
function readOwner(lockPath: string): LockOwner | undefined {
  let raw: string;
  try {
    raw = readFileSync(lockPath, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // `ENOENT` — vanished between the `EEXIST` and the read. Benign race: the lock is gone.
    if (code === "ENOENT") return undefined;
    // `EISDIR` — the lock path is a DIRECTORY. No process in this library creates one; it is debris
    // from something else, and it will never become a readable lock. Failing closed here would lock
    // the session out forever. Treated as owner-less: acquisition proceeds and fails with the real
    // FS error, which says what is wrong — instead of a permanent SessionBusyError that says
    // nothing. It is NOT "reclaimable": the lock is not removed, and the caller proceeds without a
    // lease.
    if (code === "EISDIR") return undefined;
    // Any other read failure (`EACCES` in a shared directory, `EIO`) differs in kind: the lock
    // **exists** and it is we who cannot read the owner. Treating it as free would let two writers
    // coexist — precisely what the lease exists to prevent — and the `0600` that protects the lock
    // against forgery WIDENS that surface: in a shared directory, another user's lock is unreadable
    // by design.
    //
    // Not knowing who the owner is differs from there being no owner. Fail closed.
    throw new SessionBusyError(lockPath.replace(/\.writer\.lock$/, ""));
  }
  try {
    const d = JSON.parse(raw) as Partial<LockOwner>;
    if (
      typeof d.pid !== "number" ||
      typeof d.hostname !== "string" ||
      typeof d.mtime !== "number"
    ) {
      return undefined;
    }
    return { pid: d.pid, hostname: d.hostname, mtime: d.mtime };
  } catch {
    // Unreadable JSON: a lock nobody can interpret must not lock the session out forever. Treating
    // it as stale is the recoverable choice; the cost is the same as that of an old lock.
    return undefined;
  }
}

/** Does the process exist? `signal 0` sends nothing — it only queries permission/existence. */
function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means it EXISTS and belongs to another user.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Can the lock be taken from whoever holds it?
 *
 * ADR-2 of the plan: reclaiming by `pid` alone has a false positive across machines — the same
 * number exists on another host, pointing at an unrelated process. So:
 *
 * - **same host:** the `pid` is authoritative, and it **alone**. Dead process => reclaimable at
 *   once; live process => never, however old the lock is.
 * - **other host:** the `pid` says nothing here. Only the heartbeat window counts, because it is
 *   the one signal that does not lie across machines.
 *
 * ## Why age does NOT count on the same host
 *
 * The first version did `stale || !processAlive(pid)`, and that was a serious defect: `mtime` is
 * written at **acquisition** and is not touched on each append, so any session lasting longer than
 * the window — that is, **every real session** — became stealable by another process. Two writers
 * on the same transcript is exactly what the lease exists to prevent.
 *
 * On the same host the question "does the owner still exist?" has an exact answer, and age adds no
 * information to it — only a way to be wrong. Keeping the window there would be heuristic layered
 * on top of a fact.
 */
function reclaimable(owner: LockOwner | undefined): boolean {
  if (owner === undefined) return true; // unreadable or vanished
  if (owner.hostname !== hostname()) {
    return Date.now() - owner.mtime > HEARTBEAT_WINDOW_MS;
  }
  return !processAlive(owner.pid);
}

/**
 * Does the session have a writer **right now**? A query that does NOT take the lease.
 *
 * M95 — it exists because asking by taking creates the very contention it meant to detect: two
 * processes querying a **free** session at the same time made one of them lose, and the consumer
 * forked for no reason. Measured in adversarial review: `RACE: spurious forks = 1`.
 *
 * It is a snapshot, not a guarantee: between the query and the real acquisition someone may take
 * the session. Callers needing the guarantee use {@link acquireSessionWriter}; callers needing to
 * **decide an id before opening anything** use this, and handle the race where it shows up.
 *
 */
export function sessionHasWriter(sessionPath: string): boolean {
  const lockPath = `${sessionPath}.writer.lock`;
  if (!existsSync(lockPath)) return false;
  try {
    return !reclaimable(readOwner(lockPath));
  } catch {
    // `readOwner` throws when the lock exists and cannot be read — fail closed, for the same reason
    // as there: not knowing who the owner is differs from there being no owner.
    return true;
  }
}

/**
 * Take the exclusive writer lease for `sessionPath`, or reject with {@link SessionBusyError}.
 *
 * The lock is a sibling `.lock` file created with `wx` — the same file-existence primitive the
 * SDK's `withFileLock` builds on. Exclusivity comes from the filesystem, so it holds across
 * processes, not just across async tasks in one process.
 */
export async function acquireSessionWriter(sessionPath: string): Promise<SessionWriterLease> {
  // M95 — `.writer.lock`, NOT `.lock`.
  //
  // `withFileLock(path, fn)` already uses `<path>.lock` as its companion. While the lease was called
  // from nowhere (the defect this milestone fixes) the collision was theoretical; wiring it to the
  // same file would make the long-lived lease block every short critical section on the same path.
  //
  // Two files because they are two things: `withFileLock` protects a section with a start and an
  // end; the lease is OWNERSHIP, held across turns, with an explicit `release()` — the distinction
  // the M81 docstring above already explains.
  const lockPath = `${sessionPath}.writer.lock`;
  const mine: LockOwner = ownerNow();
  let fd: number;
  try {
    // The mode applies on CREATION — the `w` in `writeOwner` does not alter an existing file.
    fd = openSync(lockPath, "wx", 0o600);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    // M95 — the lock exists. Until now that alone was enough to refuse, and that was the defect: a
    // TUI killed by SIGKILL locked the user out of their own session PERMANENTLY, with no documented
    // recovery path. Now the lock says who the owner is, and a dead owner yields its place.
    if (!reclaimable(readOwner(lockPath))) throw new SessionBusyError(sessionPath);
    writeOwner(lockPath, mine);
    return createLease(sessionPath, lockPath);
  }
  closeSync(fd);
  writeOwner(lockPath, mine);

  return createLease(sessionPath, lockPath);
}

/** The lease itself — idempotent `release()`. Extracted because acquisition has two exit paths. */
function createLease(sessionPath: string, lockPath: string): SessionWriterLease {
  let released = false;
  return {
    sessionPath,
    release: async (): Promise<void> => {
      if (released) return;
      released = true;
      rmSync(lockPath, { force: true });
    },
    renew: (): void => {
      // A released lease does not own the lock. Re-stamping here would RE-CREATE the file and give
      // this process ownership it explicitly gave up — the one way this method could manufacture the
      // double-writer the lease exists to prevent.
      if (released) return;
      writeOwner(lockPath, ownerNow());
    },
  };
}
