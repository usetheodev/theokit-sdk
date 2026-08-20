/**
 * `PtyInteractiveBackend` — the LOCAL implementation of `@theokit/sdk`'s
 * `InteractiveBackend`, backed by `node-pty`. This is the terminal-surface
 * backend: it allocates a real pseudo-terminal so REPLs, `git rebase -i`, and
 * prompting commands can be driven to completion. Ported from the AgentBuilder
 * Codex clone (M11) into the ecosystem (M14) so any terminal agent injects it.
 *
 * `node-pty` is an OPTIONAL dependency of this package — the ONLY place in the
 * theokit ecosystem that touches it. Core / sdk-tools / cluster / desktop never
 * do. When the native module is unavailable (or a spawn fails), `startInteractive`
 * throws the SDK's typed {@link InteractiveUnavailableError} so the caller falls
 * back to non-interactive exec; `available()` reports `false` up front, and
 * `writeStdin` / `kill` are unreachable because no session was ever created.
 *
 * Safety (mirrors M11): graceful typed degradation; per-session write
 * serialization (concurrent writes never steal each other's output); idle TTL
 * reaper; process-GROUP kill so detached grandchildren die; a process-exit
 * reaper; tail-capped output (the live prompt, not the stale banner).
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

import {
  InteractiveBackend,
  InteractiveUnavailableError,
  NoSuchSessionError,
  type StartInteractiveOptions,
  type StartInteractiveResult,
  type WriteStdinOptions,
  type WriteStdinResult,
} from "@theokit/sdk/interactive";

const nodeRequire = createRequire(import.meta.url);

/**
 * Floor for `StartInteractiveOptions.yieldMs` — how long a call waits for the process to produce
 * output before returning what it has.
 *
 * A shorter wait does not make the call faster, it makes it return an empty or truncated buffer that
 * the model then reasons about as if the program had said nothing. Anything below this is clamped
 * up, silently and on purpose: the alternative is an agent concluding a command produced no output
 * when it simply had not flushed yet.
 */
export const YIELD_MIN_MS = 250;

/**
 * Ceiling for `StartInteractiveOptions.yieldMs`, clamped down.
 *
 * A pty session is interactive; a caller asking to block for longer than this wants a batch command,
 * which `shell` already does without holding a session open. The cap is what keeps a mistyped
 * `yieldMs` from parking an agent turn indefinitely.
 */
export const YIELD_MAX_MS = 30_000;
const DEFAULT_YIELD_MS = 500;
const DEFAULT_TTL_MS = 300_000; // 5 min idle → reap
const DEFAULT_MAX_BYTES = 100_000;

/** The minimal `node-pty` surface driven here (kept structural so the import stays lazy). */
interface PtyProcess {
  readonly pid: number;
  write(data: string): void;
  kill(signal?: string): void;
  onData(cb: (data: string) => void): void;
  onExit(cb: (e: { exitCode: number }) => void): void;
}
interface PtyModule {
  spawn(file: string, args: string[], opts: Record<string, unknown>): PtyProcess;
}

interface PtySession {
  id: string;
  pty: PtyProcess;
  pending: string;
  alive: boolean;
  ttlTimer: ReturnType<typeof setTimeout>;
  writeChain: Promise<unknown>;
}

/** Bound the yield window to [{@link YIELD_MIN_MS}, {@link YIELD_MAX_MS}]. */
export function clampYield(ms: number | undefined): number {
  const v = ms ?? DEFAULT_YIELD_MS;
  return Math.max(YIELD_MIN_MS, Math.min(YIELD_MAX_MS, v));
}

/** Keep the TAIL of output — the newest bytes carry the live prompt. */
function capTail(buf: string, max: number): string {
  return buf.length > max ? `…(truncated)\n${buf.slice(-max)}` : buf;
}

/**
 * Constructor options for {@link PtyInteractiveBackend}. Both are optional; `new
 * PtyInteractiveBackend()` gives unconfined commands and an unlimited number of sessions.
 *
 * @public
 */
export interface PtyInteractiveBackendOptions {
  /**
   * Transforms the command immediately before the spawn. It receives the ALREADY-RESOLVED `cwd` — the PTY spawns
   * in it, so a wrap targeting another directory would produce confinement that confines nothing.
   *
   * Returning `null` means **do not wrap** — an explicit decision, distinct from "I wrapped and it made no
   * difference". It is the case of the unconfined mode.
   */
  readonly wrapCommand?: (command: string, cwd: string) => string | null;

  /**
   * M77 — ceiling on simultaneously LIVE sessions. Absent => no ceiling (the long-standing behavior).
   *
   * Each session is a real process with a 5-minute TTL. A model that does not notice it already has a
   * shell open opens another, and the TTL only collects later — too late when the limit is the machine's
   * PID count. On overflow, {@link MaxSessionsError} lists the live sessions, because the correct
   * action is to **reuse** one of them, and an error that does not say so only teaches the model to retry.
   */
  readonly maxSessions?: number;
}

/**
 * M77 — the {@link PtyInteractiveBackendOptions.maxSessions} ceiling was reached.
 *
 * Carries `liveSessionIds` by design: `rules/error-handling.md § 2` asks for a message with enough
 * context to act, and here the action is reusing an existing session. An error merely stating
 * "limit reached" would leave the model with no way out — it would retry, and fail again.
 *
 * It EXTENDS {@link InteractiveUnavailableError} and inherits its
 * `code === "interactive_unavailable"`, so a caller catching the parent — or branching on `code` —
 * cannot tell "no pty on this machine" from "you already have N open". Use `instanceof
 * MaxSessionsError` when the two need different handling; only this one is retryable after a
 * `kill()`.
 *
 * @public
 */
export class MaxSessionsError extends InteractiveUnavailableError {
  constructor(
    readonly max: number,
    readonly liveSessionIds: readonly string[],
  ) {
    super(
      `interactive session limit reached (${String(max)} live). ` +
        `Reuse one of the open sessions instead of starting another: ${liveSessionIds.join(", ")}`,
    );
  }
}

/**
 * `InteractiveBackend` backed by a real pty, for programs that only behave correctly on a terminal.
 *
 * Use it when the target REQUIRES a tty — a REPL that prints a prompt, an installer that asks a
 * question, `ssh` asking for a passphrase, anything that checks `isatty` and changes behaviour. For
 * a command that reads stdin and exits, the plain `shell` tool is simpler and does not leave a
 * session to reap.
 *
 * `node-pty` is an OPTIONAL dependency (`optionalDependencies`, not a peer), imported lazily on
 * first use: an install that cannot build the native module still succeeds, and a caller that never
 * starts a session never needs one. When it is absent,
 * starting a session raises `InteractiveUnavailableError` rather than failing at import time — so an
 * agent that merely has the backend registered still runs.
 *
 * Sessions are stateful and idle-reaped (5 minutes by default). A session id that has been reaped
 * raises `NoSuchSessionError`, which is a different fact from "the command failed" and should be
 * handled as "start again", not as an error from the program.
 */
export class PtyInteractiveBackend extends InteractiveBackend {
  private readonly sessions = new Map<string, PtySession>();
  private readonly wrapCommand: ((command: string, cwd: string) => string | null) | undefined;
  /** M77 — live-session ceiling; `undefined` means unlimited (the historical behaviour). */
  private readonly maxSessions: number | undefined;

  constructor(options: PtyInteractiveBackendOptions = {}) {
    super();
    this.wrapCommand = options.wrapCommand;
    this.maxSessions = options.maxSessions;
  }

  private ptyModule: PtyModule | null | undefined;
  private exitReaperArmed = false;

  /** Lazy, cached node-pty load — a failed native build must degrade, not crash at import time. */
  private loadPty(): PtyModule | null {
    if (this.ptyModule !== undefined) return this.ptyModule;
    try {
      this.ptyModule = nodeRequire("node-pty") as PtyModule;
    } catch {
      this.ptyModule = null;
    }
    return this.ptyModule;
  }

  /**
   * Whether `node-pty` loaded — i.e. whether `startInteractive` can work at all here.
   *
   * Extra to the `InteractiveBackend` contract; a caller writing against the base class must catch
   * {@link InteractiveUnavailableError} instead. `require`s the native module on the first call and
   * CACHES the answer for the life of this instance, so it is cheap to poll and will not notice a
   * module installed afterwards.
   *
   * `true` does not promise a session: the spawn can still fail, and a missing `cwd` is rejected —
   * both surface as {@link InteractiveUnavailableError} from `startInteractive`.
   */
  available(): boolean {
    return this.loadPty() !== null;
  }

  /** Reap orphaned PTYs when the host process exits. ONLY the `exit` event — installing SIGINT/SIGTERM
   *  handlers would remove Node's default terminate-on-signal behavior. Armed once, lazily. */
  private armExitReaper(): void {
    if (this.exitReaperArmed) return;
    this.exitReaperArmed = true;
    process.on("exit", () => this.killAll());
  }

  private async collect(session: PtySession, yieldMs: number, maxBytes: number): Promise<string> {
    await new Promise((r) => setTimeout(r, clampYield(yieldMs)));
    const out = session.pending;
    session.pending = "";
    return capTail(out, maxBytes);
  }

  private armTtl(session: PtySession, ttlMs: number): void {
    clearTimeout(session.ttlTimer);
    session.ttlTimer = setTimeout(() => this.kill(session.id), ttlMs);
  }

  /** Allocate a PTY for `command` or throw a typed {@link InteractiveUnavailableError}. Validates the
   *  cwd at the boundary (node-pty does NOT throw on a non-existent cwd — it spawns a broken session). */
  private spawnPty(command: string, opts?: StartInteractiveOptions): PtyProcess {
    const pty = this.loadPty();
    if (pty === null) {
      throw new InteractiveUnavailableError(
        "interactive shell unavailable: node-pty native module failed to load; use non-interactive exec",
      );
    }
    const cwd = opts?.cwd ?? process.cwd();
    if (!existsSync(cwd)) {
      throw new InteractiveUnavailableError(
        `interactive shell unavailable: cwd does not exist: ${cwd}`,
      );
    }
    // M75 T3.1 — the wrap goes HERE: after the cwd is resolved and validated, before the spawn. It is the
    // single point every command passes through, so no path escapes the confinement.
    const effective = this.wrapCommand?.(command, cwd) ?? command;

    const shell = process.env.SHELL ?? "/bin/bash";
    try {
      return pty.spawn(shell, ["-c", effective], {
        name: "xterm-color",
        cols: opts?.cols ?? 80,
        rows: opts?.rows ?? 24,
        cwd,
        env: process.env,
      });
    } catch (err) {
      throw new InteractiveUnavailableError(
        `interactive shell unavailable: failed to spawn a PTY (${err instanceof Error ? err.message : String(err)})`,
      );
    }
  }

  /**
   * Spawn `command` on a real pty and return its id plus whatever it printed during the yield
   * window.
   *
   * ```ts
   * const { sessionId, output } = await backend.startInteractive("python3 -i");
   * await backend.writeStdin(sessionId, "print(1+1)\n");
   * backend.kill(sessionId);
   * ```
   *
   * The command runs as `$SHELL -c <command>`, falling back to `/bin/bash` when `SHELL` is unset —
   * so shell syntax works, and so does the user's rc-file behaviour. The child inherits
   * `process.env` WHOLE; there is no allowlist, so every secret in the parent's environment is
   * visible to it.
   *
   * Defaults applied here: `yieldMs` 500 (clamped into [{@link YIELD_MIN_MS},
   * {@link YIELD_MAX_MS}]), `ttlMs` 300000 (5 min idle, then reaped), `maxBytes` 100000, `cols` 80,
   * `rows` 24, `cwd` `process.cwd()`.
   *
   * IT ALWAYS RESOLVES AFTER THE YIELD WINDOW, never when the program is ready. `output` is
   * whatever arrived by then, TAIL-capped to `maxBytes` with a `…(truncated)` marker — so a slow
   * starter returns an empty string that reads exactly like "the program said nothing". Poll with
   * `writeStdin(id, "")` rather than raising `yieldMs`.
   *
   * Throws {@link InteractiveUnavailableError} when `node-pty` is absent, when `cwd` does not exist
   * (checked here because node-pty spawns a broken session instead of failing), or when the spawn
   * itself fails. Throws {@link MaxSessionsError} — a SUBCLASS of it, so a `catch` on the parent
   * swallows the distinction — when `maxSessions` is set and reached.
   *
   * The session outlives this call and must be reclaimed: `kill()` it, or let the idle TTL do it.
   */
  async startInteractive(
    command: string,
    opts?: StartInteractiveOptions,
  ): Promise<StartInteractiveResult> {
    this.armExitReaper();
    // M77 — the ceiling, checked against LIVE sessions (`onExit` and `kill` both delete from the
    // Map), so killing one frees a slot.
    //
    // ATOMICITY, and why it is not an accident to preserve carelessly: everything from here down to
    // `this.sessions.set(id, session)` is SYNCHRONOUS — `spawnPty` does not await. Two concurrent
    // `startInteractive` calls therefore cannot interleave between this check and the insert, so the
    // ceiling holds without a lock. If a future refactor makes any step in that span asynchronous
    // (an `await this.loadPty()` would be the plausible one), both callers would observe the old
    // count and both would pass. `tests/max-sessions.test.ts` covers exactly that regression.
    if (this.maxSessions !== undefined && this.sessions.size >= this.maxSessions) {
      throw new MaxSessionsError(this.maxSessions, [...this.sessions.keys()]);
    }
    const ttlMs = opts?.ttlMs ?? DEFAULT_TTL_MS;
    const maxBytes = opts?.maxBytes ?? DEFAULT_MAX_BYTES;
    const proc = this.spawnPty(command, opts);
    const id = `pty-${randomUUID()}`;
    const session: PtySession = {
      id,
      pty: proc,
      pending: "",
      alive: true,
      ttlTimer: setTimeout(() => this.kill(id), ttlMs),
      writeChain: Promise.resolve(),
    };
    proc.onData((data) => {
      session.pending = capTail(session.pending + data, maxBytes);
    });
    proc.onExit(() => {
      session.alive = false;
      clearTimeout(session.ttlTimer);
      this.sessions.delete(id);
    });
    this.sessions.set(id, session);
    const output = await this.collect(session, opts?.yieldMs ?? DEFAULT_YIELD_MS, maxBytes);
    return { sessionId: id, output };
  }

  /**
   * Write `chars` to a live session's stdin and return the output produced during the yield window,
   * plus whether the process is still alive.
   *
   * YOU SUPPLY THE NEWLINE. `"print(1+1)"` leaves a REPL waiting; `"print(1+1)\n"` runs it. An
   * EMPTY `chars` writes nothing and just waits — the supported way to poll a program that is still
   * producing output.
   *
   * Every call resets the idle TTL, so a polled session never gets reaped mid-work. Defaults match
   * `startInteractive`: `yieldMs` 500 (clamped), `ttlMs` 300000, `maxBytes` 100000 tail-capped.
   *
   * Concurrent calls on the same session are SERIALIZED, each reading only its own output window —
   * two writes in flight cannot steal each other's output. They are not, however, interleaved with
   * anything the program prints unprompted, which is drained by whichever call is waiting.
   *
   * Throws {@link NoSuchSessionError} when the id is unknown, already killed, or was reaped for
   * idleness. That is a different fact from a failing command: the correct response is to start a
   * new session, not to report an error from the program.
   */
  async writeStdin(
    sessionId: string,
    chars: string,
    opts?: WriteStdinOptions,
  ): Promise<WriteStdinResult> {
    const session = this.sessions.get(sessionId);
    if (session === undefined || !session.alive) throw new NoSuchSessionError(sessionId);
    // Serialize per session: chain onto the previous write so two concurrent calls run strictly in
    // order and each reads only its own output window (no stolen output).
    const run = session.writeChain.then(async () => {
      if (!session.alive) throw new NoSuchSessionError(sessionId);
      this.armTtl(session, opts?.ttlMs ?? DEFAULT_TTL_MS);
      if (chars.length > 0) session.pty.write(chars);
      const output = await this.collect(
        session,
        opts?.yieldMs ?? DEFAULT_YIELD_MS,
        opts?.maxBytes ?? DEFAULT_MAX_BYTES,
      );
      return { output, alive: session.alive };
    });
    session.writeChain = run.catch(() => undefined);
    return run;
  }

  /**
   * End a session and free its `maxSessions` slot. Idempotent — an unknown or already-killed id is a
   * silent no-op, never a throw.
   *
   * SIGKILLs the whole process GROUP, so a detached grandchild dies with it; there is no graceful
   * shutdown and no chance for the program to flush or save. Falls back to killing just the pty
   * process if the group kill fails. Any output buffered but not yet collected is discarded.
   */
  kill(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session === undefined) return;
    clearTimeout(session.ttlTimer);
    session.alive = false;
    this.sessions.delete(sessionId);
    try {
      process.kill(-session.pty.pid, "SIGKILL");
    } catch {
      try {
        session.pty.kill();
      } catch {
        // already dead — nothing to do
      }
    }
  }

  /**
   * `kill()` every live session of THIS backend instance. Extra to the `InteractiveBackend`
   * contract.
   *
   * Also runs automatically on the host process's `exit` event, armed lazily on the first
   * `startInteractive`. Only `exit` — installing SIGINT/SIGTERM handlers would suppress Node's
   * default terminate-on-signal, so a `kill -9` of the host still orphans the ptys.
   */
  killAll(): void {
    for (const id of [...this.sessions.keys()]) this.kill(id);
  }

  /**
   * How many sessions this instance currently holds — the number `maxSessions` is compared against.
   * Extra to the `InteractiveBackend` contract.
   *
   * Drops on its own when a process exits or a TTL fires, so it is a live gauge rather than a
   * counter, and it never counts sessions belonging to another backend instance.
   */
  activeSessionCount(): number {
    return this.sessions.size;
  }
}
