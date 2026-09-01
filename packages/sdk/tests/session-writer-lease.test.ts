/**
 * M81 T1.2 — single-writer lease for a session.
 *
 * ## The measured problem
 *
 * Nothing today stops two processes appending to the same JSONL transcript. The concrete case M81
 * cites: `exec resume --last` can write into the TUI's live session. Two interleaved writes in an
 * append-only file produce a file whose lines are individually valid and whose SEQUENCE is
 * fiction — and nothing flags it, because each line parses on its own.
 *
 * ## The plan's ADR D2 said "composes `withFileLock`", and the implementation diverged — with the reason written down
 *
 * D2's instinct was right: do not build a second locking mechanism. What did not fit was the
 * SHAPE. `withFileLock(path, fn)` is scope-based — it holds the lock for a callback's duration.
 * A session lease is held **across turns**, for as long as the process owns the session, with an
 * explicit `release()`. Wrapping the session's whole lifecycle in a callback would invert the
 * control of the agent loop.
 *
 * The implementation uses the SAME primitive `withFileLock` uses underneath — an exclusive-creation
 * lockfile (`wx`) — with lease semantics on top. The mechanism stays single; only its lifetime changed.
 * The divergence is recorded in the source, not hidden.
 *
 * ## Fails FAST, does not wait
 *
 * A second writer waiting for the lease would block `exec` behind a TUI session that can
 * last hours. `rules/error-handling.md` § 2 asks for a typed error; here it also has to be immediate,
 * so the caller can choose between forking and giving up.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  acquireSessionWriter,
  SessionBusyError,
} from "../src/internal/persistence/session-writer.js";

const dir = mkdtempSync(join(tmpdir(), "m81-lease-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const session = (name: string): string => join(dir, `${name}.jsonl`);

describe("M81 T1.2 — session writer lease", () => {
  it("test_the_first_writer_gets_the_lease", async () => {
    const lease = await acquireSessionWriter(session("a"));
    expect(lease).toBeDefined();
    await lease.release();
  });

  it("test_the_second_FAILS_FAST_with_a_typed_error", async () => {
    // Waiting would block `exec` behind a TUI session that can last hours. The typed error lets
    // the caller choose: fork to a new id, or give up with a diagnostic.
    const first = await acquireSessionWriter(session("b"));
    const start = Date.now();

    await expect(acquireSessionWriter(session("b"))).rejects.toBeInstanceOf(SessionBusyError);
    expect(Date.now() - start, "must fail fast, not wait for the lease").toBeLessThan(2000);

    await first.release();
  });

  it("test_releasing_the_lease_lets_the_next_one_in", async () => {
    const first = await acquireSessionWriter(session("c"));
    await first.release();

    // Without this, the lease would be a permanent lock rather than a lease.
    const second = await acquireSessionWriter(session("c"));
    expect(second).toBeDefined();
    await second.release();
  });

  it("test_COUNTERPROOF_distinct_sessions_do_not_contend", async () => {
    // Without this, a global lease would pass the tests above and serialize EVERY session — the
    // opposite of the goal, and invisible until someone runs two agents at once.
    const a = await acquireSessionWriter(session("d1"));
    const b = await acquireSessionWriter(session("d2"));

    expect(a).toBeDefined();
    expect(b).toBeDefined();
    await a.release();
    await b.release();
  });

  it("test_two_concurrent_acquisitions_only_one_wins", async () => {
    // Concurrent test with an atomic-counter invariant: `Promise.allSettled` of two acquisitions =>
    // exactly 1 `fulfilled` and 1 `rejected`. A lease that let both through would be
    // decorative — and that is precisely today's state, with no lease at all.
    const p = session("e");
    const r = await Promise.allSettled([acquireSessionWriter(p), acquireSessionWriter(p)]);

    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(r.filter((x) => x.status === "rejected")).toHaveLength(1);

    for (const x of r) {
      if (x.status === "fulfilled") await x.value.release();
    }
  });

  it("test_the_error_names_the_contended_session", async () => {
    // `error-handling.md` § 2: enough context to act. Knowing WHICH session is busy is what
    // lets the caller decide between forking and waiting for the user to close the TUI.
    const p = session("f");
    const first = await acquireSessionWriter(p);
    const err = (await acquireSessionWriter(p).catch((e: unknown) => e)) as SessionBusyError;

    expect(err.sessionPath).toBe(p);
    expect(err.message).toContain(p);
    await first.release();
  });
});

/**
 * `agent-builder#118` — a live owner must never cross the staleness window.
 *
 * The record `{pid, hostname, mtime}` was written **once**, at acquisition, and never renewed. On the
 * same host that is harmless: `reclaimable` decides by `pid`, which is exact, and age never enters the
 * calculation. Across hosts it is not harmless — `pid` from another machine means nothing, so age is
 * the only signal, and **any real session** older than the window became reclaimable while its owner
 * was still writing. Two writers on one transcript is what the lease exists to prevent.
 *
 * `renew()` re-stamps the record. It is not an internal timer on purpose: a timer would renew the
 * lease of a process that is **hung** rather than working, which is exactly the state the window
 * exists to detect. Tied to a real write, the record tracks **progress**.
 */
describe("agent-builder#118 — the ownership record is renewable", () => {
  const readOwner = (sessionPath: string): { pid: number; mtime: number } =>
    JSON.parse(readFileSync(`${sessionPath}.writer.lock`, "utf8")) as {
      pid: number;
      mtime: number;
    };

  it("test_renew_advances_the_recorded_mtime", async () => {
    const p = join(dir, "renew.jsonl");
    const lease = await acquireSessionWriter(p);
    try {
      const before = readOwner(p).mtime;
      await new Promise((r) => setTimeout(r, 5));
      lease.renew();
      expect(
        readOwner(p).mtime,
        "renew() did not advance the record — a live owner still crosses the window",
      ).toBeGreaterThan(before);
    } finally {
      await lease.release();
    }
  });

  it("test_renew_keeps_the_SAME_owner", async () => {
    // Counterproof against the tempting shortcut of rewriting the record from scratch with whatever
    // is around: the renewal must not change WHO holds the lease.
    const p = join(dir, "renew-owner.jsonl");
    const lease = await acquireSessionWriter(p);
    try {
      const before = readOwner(p).pid;
      lease.renew();
      expect(readOwner(p).pid).toBe(before);
      expect(readOwner(p).pid).toBe(process.pid);
    } finally {
      await lease.release();
    }
  });

  it("test_NEGATIVE_renew_after_release_does_NOT_recreate_the_lock", async () => {
    // The one direction of this API that could MANUFACTURE the double-writer it exists to prevent:
    // re-stamping a lease you gave up would re-create the lock file and take ownership back.
    const p = join(dir, "renew-after-release.jsonl");
    const lease = await acquireSessionWriter(p);
    await lease.release();
    lease.renew();
    expect(
      existsSync(`${p}.writer.lock`),
      "renew() after release() re-created the lock — the released process took ownership back",
    ).toBe(false);
  });

  it("test_COUNTERPROOF_the_lock_exists_while_the_lease_is_held", async () => {
    // Without this, a renew() that never wrote anything would satisfy the negative above.
    const p = join(dir, "held.jsonl");
    const lease = await acquireSessionWriter(p);
    try {
      expect(existsSync(`${p}.writer.lock`)).toBe(true);
    } finally {
      await lease.release();
    }
  });
});
