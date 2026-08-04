/**
 * M77 T5.1 — `maxSessions`: a ceiling so the model stops opening shells indefinitely.
 *
 * ## O problema
 *
 * `startInteractive` creates a session and stores it in the `Map` (`pty-interactive-backend.ts:91`) with
 * no limit at all. Each is a real process with a TTL of hours. A model that does not notice it already
 * has a shell open opens another — and another. The TTL eventually collects, but "eventually" is too
 * late when the limit is the machine's PID count.
 *
 * ## The error has to SAY WHAT TO DO
 *
 * An error that only says "limit reached" teaches the model to retry. `rules/error-handling.md`
 * § 2 requires a message with context; here the useful context is the **list of live sessions**, because the
 * correct action is to reuse one of them, not to wait. It is the difference between an error that interrupts and one
 * que orienta.
 *
 * ## Why a REAL PTY, and not a `spawnPty` double
 *
 * The first version of this file subclassed the backend to swap `spawnPty` for a double. Two
 * reasons for abandoning that, and the second is the one that matters:
 *
 *  1. `spawnPty` is `private` — the double would require loosening visibility just for the test;
 *  2. **the M75 lesson**: a helper replacing the whole of `spawnPty` makes everything living INSIDE it
 *     never run. The ceiling has to prove the slot is counted against sessions that genuinely exist,
 *     with a real `onExit` freeing the slot — a double would only prove that my double counts.
 *
 * This file follows the convention `pty-interactive-backend.test.ts` already established: a real PTY, and
 * `describe.skip` when node-pty's native build is unavailable.
 */
import { afterEach, describe, expect, it } from "vitest";

import { MaxSessionsError, PtyInteractiveBackend } from "../src/pty-interactive-backend.js";

const probe = new PtyInteractiveBackend();
const d = probe.available() ? describe : describe.skip;

let backend: PtyInteractiveBackend;
afterEach(() => {
  backend?.killAll();
});

const abrir = (b: PtyInteractiveBackend): Promise<{ sessionId: string }> =>
  b.startInteractive("cat", { yieldMs: 60 });

d("M77 T5.1 — interactive session ceiling (real PTY)", () => {
  it("test_opening_past_the_ceiling_throws_a_TYPED_error", async () => {
    backend = new PtyInteractiveBackend({ maxSessions: 2 });
    await abrir(backend);
    await abrir(backend);

    // A domain error, not a generic `Error` — the handler needs to tell "ceiling" from "spawn failed".
    await expect(abrir(backend)).rejects.toBeInstanceOf(MaxSessionsError);
  });

  it("test_the_error_LISTS_the_live_sessions_so_the_model_can_reuse_one", async () => {
    backend = new PtyInteractiveBackend({ maxSessions: 2 });
    const a = await abrir(backend);
    const c = await abrir(backend);

    const err = (await abrir(backend).catch((e: unknown) => e)) as MaxSessionsError;

    // The part that turns an interrupting error into guidance.
    expect(err.liveSessionIds).toHaveLength(2);
    expect(err.liveSessionIds).toContain(a.sessionId);
    expect(err.liveSessionIds).toContain(c.sessionId);
    // And the message, which is what the model actually reads, has to carry the ids.
    expect(err.message).toContain(a.sessionId);
  });

  it("test_killing_a_session_FREES_the_slot", async () => {
    backend = new PtyInteractiveBackend({ maxSessions: 1 });
    const a = await abrir(backend);
    await expect(abrir(backend)).rejects.toBeInstanceOf(MaxSessionsError);

    backend.kill(a.sessionId);

    // If the ceiling counted already-opened sessions instead of LIVE ones, this open would still fail.
    await expect(abrir(backend)).resolves.toBeDefined();
  });

  it("test_COUNTERPROOF_without_maxSessions_there_is_no_ceiling", async () => {
    // Without this, an implementation with a baked-in ceiling (say 3) would pass everything above and break
    // every existing consumer silently. The default MUST be unlimited.
    backend = new PtyInteractiveBackend();
    for (let i = 0; i < 4; i++) await abrir(backend);
    expect(backend.activeSessionCount()).toBe(4);
  });

  it("test_duas_aberturas_concorrentes_no_limite_so_uma_passa", async () => {
    // Concurrent test with an atomic-counter invariant: with a ceiling of 1, two simultaneous opens contend for
    // the last slot. The guard must read the count and reserve the slot BEFORE the first `await`; if it
    // checked and only inserted into the `Map` after the spawn (which is async), both would see `0`, both
    // both would pass, and the ceiling would become decorative.
    backend = new PtyInteractiveBackend({ maxSessions: 1 });
    const r = await Promise.allSettled([abrir(backend), abrir(backend)]);

    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(r.filter((x) => x.status === "rejected")).toHaveLength(1);
    expect(backend.activeSessionCount(), "no session may have leaked past the ceiling").toBe(1);
  });
});
