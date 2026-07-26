/**
 * `PtyInteractiveBackend` — the LOCAL implementation of `@theokit/sdk`'s
 * `InteractiveBackend`, backed by `node-pty`. This is the terminal-surface
 * backend: it allocates a real pseudo-terminal so REPLs, `git rebase -i`, and
 * prompting commands can be driven to completion. Ported from the AgentBuilder
 * Codex clone (M11) into the ecosystem (M14) so any terminal agent injects it.
 *
 * `node-pty` is an OPTIONAL dependency of this package — the ONLY place in the
 * theokit ecosystem that touches it. Core / sdk-tools / cluster / desktop never
 * do. When the native module is unavailable (or a spawn fails), every method
 * throws the SDK's typed {@link InteractiveUnavailableError} so the caller falls
 * back to non-interactive exec.
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

export const YIELD_MIN_MS = 250;
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
 * M75 T3.1 — como o chamador embrulha o comando antes do spawn.
 *
 * Existe para que confinamento (sandbox) componha com PTY sem herança: o backend continua dono do
 * spawn, o chamador continua dono da política, e nenhum dos dois conhece o tipo do outro.
 */
export interface PtyInteractiveBackendOptions {
  /**
   * Transforma o comando imediatamente antes do spawn. Recebe o `cwd` JÁ RESOLVIDO — o PTY spawna
   * nele, então um wrap que mirasse outro diretório produziria confinamento que não confina nada.
   *
   * Devolver `null` significa **não embrulhe** — decisão explícita, distinta de "embrulhei e deu no
   * mesmo". É o caso do modo sem confinamento.
   */
  readonly wrapCommand?: (command: string, cwd: string) => string | null;

  /**
   * M77 — teto de sessões VIVAS simultâneas. Ausente ⇒ sem teto (o comportamento de sempre).
   *
   * Cada sessão é um processo real com TTL de 5 minutos. Um modelo que não percebe que já tem um
   * shell aberto abre outro, e o TTL só recolhe depois — tarde demais quando o limite é o número de
   * PIDs da máquina. Ao estourar, {@link MaxSessionsError} lista as sessões vivas, porque a ação
   * correta é **reusar** uma delas e um erro que não diz isso só ensina o modelo a tentar de novo.
   */
  readonly maxSessions?: number;
}

/**
 * M77 — o teto de {@link PtyInteractiveBackendOptions.maxSessions} foi atingido.
 *
 * Carrega `liveSessionIds` por design: `rules/error-handling.md § 2` pede mensagem com contexto
 * suficiente para agir, e aqui a ação é reusar uma sessão existente. Um erro que apenas informasse
 * "limite atingido" deixaria o modelo sem saída — ele tentaria de novo, falharia de novo.
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

  /** Whether the interactive (PTY) path is usable in this environment. */
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
    // M75 T3.1 — o wrap entra AQUI: depois do cwd resolvido e validado, antes do spawn. É o ponto
    // único por onde todo comando passa, então não há caminho que escape do confinamento.
    const efetivo = this.wrapCommand?.(command, cwd) ?? command;

    const shell = process.env.SHELL ?? "/bin/bash";
    try {
      return pty.spawn(shell, ["-c", efetivo], {
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

  /** Kill a single session (idempotent). Kills the whole process GROUP so a detached grandchild dies too. */
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

  /** Reap every session — used by the process-exit reaper; also callable on `/clear`. */
  killAll(): void {
    for (const id of [...this.sessions.keys()]) this.kill(id);
  }

  /** Live session count — for observability / tests. */
  activeSessionCount(): number {
    return this.sessions.size;
  }
}
