/**
 * M95 Phase 1 — the single-writer lease gains staleness semantics.
 *
 * The lock was a raw `openSync(path, "wx")`: exclusivity from the filesystem, and **no** way to know
 * whether the owner still exists. A TUI killed by `SIGKILL` — or by the terminal going down — left
 * the `.lock` behind and locked the user out of their own session, **permanently**, with no
 * documented recovery path.
 *
 * ADR-2: reclaiming by `pid` has a false positive across machines (the same number exists on another
 * host). Reclaiming requires `hostname` **and** `pid`; between different hosts only the heartbeat
 * window counts, because it is the one signal that does not lie.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, onTestFinished } from "vitest";
import {
  acquireSessionWriter,
  HEARTBEAT_WINDOW_MS,
  SessionBusyError,
  sessionHasWriter,
} from "../src/internal/persistence/session-writer.js";
import { removeTempDirRobustSync } from "./helpers/temp-workspace.js";

const acquired: Array<{ release: () => Promise<void> }> = [];
afterEach(async () => {
  for (const l of acquired.splice(0)) await l.release();
});

const newPath = (): string => {
  const d = mkdtempSync(join(tmpdir(), "m95-lease-"));
  onTestFinished(() => {
    removeTempDirRobustSync(d);
  });
  return join(d, "s.jsonl");
};

/** Writes a `.lock` with an arbitrary owner, simulating a process that died. */
function lockOwnedBy(path: string, owner: { pid: number; hostname: string; mtime: number }): void {
  writeFileSync(`${path}.writer.lock`, JSON.stringify(owner));
}

describe("M95 — the lock says who the owner is", () => {
  it("writes pid, hostname and mtime", async () => {
    const p = newPath();
    acquired.push(await acquireSessionWriter(p));
    const owner = JSON.parse(readFileSync(`${p}.writer.lock`, "utf8")) as Record<string, unknown>;
    expect(owner.pid).toBe(process.pid);
    expect(owner.hostname).toBe(hostname());
    expect(typeof owner.mtime).toBe("number");
  });
});

describe("M95 — when a lock is reclaimable", () => {
  it("DEAD process on the same host -> reclaimable", async () => {
    const p = newPath();
    // PID 2^22 + 1 is above /proc/sys/kernel/pid_max on any standard Linux: it does not exist.
    lockOwnedBy(p, { pid: 4_194_305, hostname: hostname(), mtime: Date.now() });
    acquired.push(await acquireSessionWriter(p));
    expect(JSON.parse(readFileSync(`${p}.writer.lock`, "utf8")).pid).toBe(process.pid);
  });

  it("ANOTHER live process on the same host -> NOT reclaimable", async () => {
    const p = newPath();
    // The parent process id exists and is not ours — a live owner belonging to someone else.
    lockOwnedBy(p, { pid: process.ppid, hostname: hostname(), mtime: Date.now() });
    await expect(acquireSessionWriter(p)).rejects.toBeInstanceOf(SessionBusyError);
  });

  it("the process ITSELF does NOT re-acquire — the primitive is strict", async () => {
    // "A lease that let both through would be decorative" — the M81 test says exactly that, and it
    // is right. The first version of M95 made an exception for our own pid to accommodate two
    // stores in one process, and thereby failed all three M81 tests.
    //
    // The right reconciliation is not to loosen the primitive: it is for the CONSUMER to count
    // references. That is what `acquireShared` does in `fs-session-store.ts` — one lease per path
    // per process, with the last release actually freeing it. Cross-process stays strict.
    const p = newPath();
    lockOwnedBy(p, { pid: process.pid, hostname: hostname(), mtime: Date.now() });
    await expect(acquireSessionWriter(p)).rejects.toBeInstanceOf(SessionBusyError);
  });

  it("other host, RECENT lock -> NOT reclaimable (their pid says nothing here)", async () => {
    const p = newPath();
    lockOwnedBy(p, { pid: 4_194_305, hostname: "another-machine", mtime: Date.now() });
    await expect(acquireSessionWriter(p)).rejects.toBeInstanceOf(SessionBusyError);
  });

  it("other host, OLD lock -> reclaimable via the window", async () => {
    const p = newPath();
    lockOwnedBy(p, {
      pid: 4_194_305,
      hostname: "another-machine",
      mtime: Date.now() - HEARTBEAT_WINDOW_MS - 1_000,
    });
    acquired.push(await acquireSessionWriter(p));
    expect(JSON.parse(readFileSync(`${p}.writer.lock`, "utf8")).hostname).toBe(hostname());
  });

  it("a CORRUPT lock is treated as stale — unreadable JSON must not lock forever", async () => {
    const p = newPath();
    writeFileSync(`${p}.writer.lock`, "{ this is not json");
    acquired.push(await acquireSessionWriter(p));
    expect(JSON.parse(readFileSync(`${p}.writer.lock`, "utf8")).pid).toBe(process.pid);
  });

  it("release removes the lock", async () => {
    // B-008. The re-acquisition below IS an oracle — a release that keeps the lock makes it reject
    // with SessionBusyError, measured. But the test is named for the lock being REMOVED, and
    // re-acquisition cannot tell removal from truncation: an empty lock file reads as corrupt, which
    // this suite treats as stale, so it would be re-acquired just the same. The file check is the
    // claim in the title; the re-acquisition stays because it covers what callers depend on.
    const p = newPath();
    const lease = await acquireSessionWriter(p);
    await lease.release();

    expect(existsSync(`${p}.writer.lock`), "release must unlink the lock file").toBe(false);
    acquired.push(await acquireSessionWriter(p));
  });
});

describe("M95 — a LIVE owner never loses the lease to age", () => {
  it("an old lock from a live process on the SAME host is NOT reclaimable", async () => {
    // `mtime` is written at ACQUISITION and is not touched on each append. With the window applying
    // on the same host too, any session lasting longer than it — that is, every real session —
    // could be stolen by another process. On the same host the `pid` is authoritative: either the
    // process exists or it does not. Age adds no information, only a way to fail.
    const p = newPath();
    lockOwnedBy(p, {
      pid: process.ppid,
      hostname: hostname(),
      mtime: Date.now() - HEARTBEAT_WINDOW_MS * 10,
    });
    await expect(acquireSessionWriter(p)).rejects.toBeInstanceOf(SessionBusyError);
  });
});

describe("M95/LOW-1 — the lock cannot be forged by another user", () => {
  it("is born 0600 — at 0664 another user in the group would overwrite and forge ownership", async () => {
    const p = newPath();
    acquired.push(await acquireSessionWriter(p));
    expect(statSync(`${p}.writer.lock`).mode & 0o077).toBe(0);
  });
});

describe("M95/LOW-3 — a lock that is a DIRECTORY does not lock the session forever", () => {
  it("EISDIR is treated as reclaimable debris, not as an unknown owner", async () => {
    // The fail-closed path in `readOwner` exists for "the lock exists and I cannot read the owner".
    // A directory will never become a readable lock: refusing forever would create the permanent
    // lockout this milestone came to eliminate.
    const p = newPath();
    mkdirSync(`${p}.writer.lock`, { recursive: true });
    await expect(acquireSessionWriter(p)).rejects.not.toBeInstanceOf(SessionBusyError);
  });
});

describe("M95 — querying is not taking (MEDIUM-1)", () => {
  it("querying a free session leaves NO trace and creates no contention", () => {
    const p = newPath();
    expect(sessionHasWriter(p)).toBe(false);
    // The previous version of the pre-check ACQUIRED in order to ask: two processes querying a free
    // session at the same time made one lose, and the consumer forked for no reason.
    expect(sessionHasWriter(p), "the query changed the state").toBe(false);
  });

  it("a session with a live owner is reported as busy", () => {
    const p = newPath();
    lockOwnedBy(p, { pid: process.ppid, hostname: hostname(), mtime: Date.now() });
    expect(sessionHasWriter(p)).toBe(true);
  });

  it("a lock from a dead owner does NOT count as a writer", () => {
    const p = newPath();
    lockOwnedBy(p, { pid: 4_194_305, hostname: hostname(), mtime: Date.now() });
    expect(sessionHasWriter(p)).toBe(false);
  });
});
