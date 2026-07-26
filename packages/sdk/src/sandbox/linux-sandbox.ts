// Promovido do agent-builder no M75 (plano m75-sandbox-kernel-no-framework, D1). Renomeado de
// `BwrapSandbox` para `LinuxSandbox`: bwrap e a IMPLEMENTACAO, Linux e o contrato — trocar o
// mecanismo (landlock, por exemplo) nao deveria mudar o nome que o consumidor importa.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { redactSecrets } from "../internal/security/redact.js";
import type { BwrapDetection, SandboxMode } from "./bwrap.js";
import { buildBwrapArgv, detectBwrapMemoizado } from "./bwrap.js";
import { LocalSandbox } from "./local-sandbox.js";
import { buildSeccompFilter } from "./seccomp.js";
import type { SandboxBackend, SandboxConfig } from "./types.js";

/**
 * M53 — kernel-enforced sandbox backend, injected into `createShellTool({ sandbox })`.
 *
 * `LinuxSandbox extends LocalSandbox` and only REWRITES the command: `<bwrap-bin> <policy flags> --
 * /bin/sh -c '<original>'`. Everything else (spawn, output caps, timeout, ExecuteResult shape, file
 * ops) is inherited — the SDK backend stays the single execution engine. Mirrors Codex's
 * `SandboxManager::transform` (argv prefixing before spawn, never in-process).
 */

/** POSIX single-quote escaping — the inner command crosses ONE extra `/bin/sh -c` boundary. */
function shellQuote(s: string): string {
  return `'${s.replaceAll("'", `'\\''`)}'`;
}

/**
 * M57 — the single source of truth for the sandbox command wrap. Turns `command` into
 * `<bin> <bwrap flags> [--seccomp 3] -- /bin/sh -c '<command>' [3< <bpf>]`, or `null` when the policy
 * skips the sandbox (`danger-full-access`). Extracted from `LinuxSandbox.wrapCommand` so the interactive
 * PTY backend (M57) can reuse the EXACT wrap the one-shot `run_shell` already uses (DRY) — faithful to
 * Codex, where the sandbox transforms the argv before the PTY spawns it (`sandboxing/src/manager.rs:321`).
 */
export function wrapCommandForSandbox(
  mode: SandboxMode,
  opts: {
    cwd: string;
    network?: boolean;
    env?: Record<string, string>;
    bin?: string;
    seccompPath?: string;
  },
  command: string,
): string | null {
  const argv = buildBwrapArgv(mode, { cwd: opts.cwd, network: opts.network, env: opts.env });
  if (argv === null) return null; // danger-full-access: bwrap skipped
  const bin = opts.bin ?? "bwrap";
  const seccompArgv = opts.seccompPath !== undefined ? ["--seccomp", "3"] : [];
  const base = `${shellQuote(bin)} ${[...argv.slice(0, -1), ...seccompArgv, "--"].map(shellQuote).join(" ")} /bin/sh -c ${shellQuote(command)}`;
  return opts.seccompPath !== undefined ? `${base} 3< ${shellQuote(opts.seccompPath)}` : base;
}

/**
 * Env allowlist re-injected inside the sandbox after `--clearenv`. Codex env_clear model: the child
 * gets exactly what it needs to run a shell, never the parent's full env (which may hold oddly-named
 * secrets the SDK name-pattern scrub misses). `CODEX_SANDBOX_NETWORK_DISABLED` is added by the argv
 * builder when network is unshared.
 */
const ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "USER",
  "TMPDIR",
  "SHELL",
];

export function allowlistedEnv(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ENV_ALLOWLIST) {
    const v = source[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}

export class LinuxSandbox extends LocalSandbox {
  private readonly mode: SandboxMode;
  private readonly network: boolean;
  private readonly cwd: string;
  private readonly bin: string;
  private readonly env: Record<string, string>;
  /** M63 — path to the cBPF seccomp program written host-side; passed to `bwrap --seccomp 3` via a
   * shell redirect. `undefined` when the network is unrestricted OR generation failed (honest fallback). */
  private readonly seccompPath: string | undefined;

  constructor(
    config: SandboxConfig,
    opts: { mode: SandboxMode; network?: boolean; bin?: string; env?: Record<string, string> },
  ) {
    super(config);
    this.mode = opts.mode;
    this.network = opts.network ?? false;
    this.cwd = config.workDir ?? process.cwd();
    // MEDIUM-1: run the VALIDATED absolute binary from detection (anti-hijack), never bare `bwrap`
    // which the outer shell would re-resolve via $PATH at spawn time (TOCTOU / hijack window).
    this.bin = opts.bin ?? "bwrap";
    this.env = opts.env ?? allowlistedEnv();
    this.seccompPath = seccompPathParaRede(this.network);
  }

  /** Extracted for test visibility — delegates to the pure `wrapCommandForSandbox` (M57, single wrap SoT). */
  wrapCommand(command: string): string | null {
    return wrapCommandForSandbox(
      this.mode,
      {
        cwd: this.cwd,
        network: this.network,
        env: this.env,
        bin: this.bin,
        seccompPath: this.seccompPath,
      },
      command,
    );
  }

  /**
   * M75 review (arquitetura, HIGH) — sem este override a classe MENTIA.
   *
   * `LinuxSandbox` se documenta como "kernel-enforced sandbox backend", mas sobrescrevia apenas
   * `execute`. `uploadFile` continuava o herdado de `LocalSandbox`, que escreve direto no host via
   * `fs/promises` e aceita caminho ABSOLUTO — sem bwrap, sem seccomp, sem restrição de caminho. E
   * `SandboxBackend.writeFile` delega a ele. O resultado era uma classe incoerente: ler, buscar e
   * listar passavam pelo confinamento; escrever, não.
   *
   * Rotear pelo `execute` embrulhado resolve na raiz: a escrita passa a viver sob a MESMA política
   * do resto — se o bwrap nega o caminho, a escrita falha, como deve. O conteúdo vai por stdin (não
   * por argv) porque argv tem limite de tamanho e conteúdo de arquivo não tem.
   */
  override async uploadFile(caminho: string, conteudo: string | Buffer): Promise<void> {
    if (this.mode === "danger-full-access") return super.uploadFile(caminho, conteudo);

    const alvo = caminho.startsWith("/") ? caminho : `${this.cwd}/${caminho}`;
    const b64 = Buffer.from(conteudo).toString("base64");
    // base64 numa única linha: evita qualquer citação de shell sobre conteúdo arbitrário, que é
    // exatamente onde uma escrita "confinada" viraria injeção de comando.
    const r = await this.execute(
      `mkdir -p ${shellQuote(dirname(alvo))} && printf %s ${shellQuote(b64)} | base64 -d > ${shellQuote(alvo)}`,
    );
    if (r.exitCode !== 0) {
      throw new Error(
        `uploadFile bloqueado ou falhou sob confinamento (${alvo}): ${r.stderr.trim() || `exit ${r.exitCode}`}`,
      );
    }
  }

  override execute(command: string, opts?: { timeoutMs?: number }) {
    const wrapped = this.wrapCommand(command);
    if (wrapped === null) return super.execute(command, opts); // danger-full-access: plain local
    return super.execute(wrapped, opts);
  }
}

let warnedNonX64 = false;

/**
 * M63 — the restricted-network seccomp program is DETERMINISTIC, so write it ONCE per process and
 * reuse the path across every LinuxSandbox (no per-instance temp accumulation).
 *
 * ARCH GUARD (review HIGH): `buildSeccompFilter` emits an x86_64 program whose arch guard KILLs every
 * syscall whose `seccomp_data.arch != AUDIT_ARCH_X86_64`. On a non-x86_64 host that would brick EVERY
 * sandboxed command (the first execve is killed) — and silently, because generation succeeds and bwrap
 * accepts it. So we REFUSE to install on non-x64 and WARN through the honest-downgrade channel (bwrap
 * FS/network confinement still applies), exactly like the bwrap-missing fallback. `arch` is injectable
 * for tests. Cleaned on exit AND on SIGINT/SIGTERM (TUI Ctrl+C would otherwise leak the temp dir).
 */
export function seccompPathForArch(arch: string, warn: (m: string) => void): string | undefined {
  if (arch !== "x64") {
    if (!warnedNonX64) {
      warnedNonX64 = true;
      warn(
        `[sandbox] seccomp syscall filter unsupported on ${arch} (x86_64 only in v1) — running without ` +
          "the filter; bwrap FS/network confinement still applies.",
      );
    }
    return undefined;
  }
  try {
    const dir = mkdtempSync(join(tmpdir(), "ab-seccomp-"));
    const path = join(dir, "filter.bpf");
    writeFileSync(path, buildSeccompFilter({ networkRestricted: true }));
    const cleanup = (): void => rmSync(dir, { recursive: true, force: true });
    process.once("exit", cleanup);
    process.once("SIGINT", cleanup);
    process.once("SIGTERM", cleanup);
    return path;
  } catch (err) {
    warn(
      `[sandbox] seccomp filter unavailable (${err instanceof Error ? err.message : String(err)}) — ` +
        "running without syscall filter (bwrap FS/network confinement still applies).",
    );
    return undefined;
  }
}

let seccompFilterPath: string | undefined | null; // undefined = not tried; null = resolved absent
/** M57 — exported so the interactive PTY backend reuses the SAME memoized x64-gated seccomp program. */
export function restrictedSeccompPath(): string | undefined {
  if (seccompFilterPath !== undefined) return seccompFilterPath ?? undefined;
  const path = seccompPathForArch(process.arch, (m) => console.warn(redactSecrets(m)));
  seccompFilterPath = path ?? null;
  return path;
}

let warnedUnavailable = false;

/** Test seam: reset the WARN-once latch. */
export function resetSandboxWarnLatch(): void {
  warnedUnavailable = false;
}

/** Durable sandbox posture for the UI — the honest answer to "am I kernel-enforced right now?". */
export interface SandboxPosture {
  mode: SandboxMode;
  enforced: boolean;
  detail: string;
}

/**
 * MEDIUM-2: compute the posture so a surface (TUI footer) can show enforcement DURABLY instead of a
 * one-shot warn. `danger-full-access` is honestly reported as unenforced; an unavailable bwrap reports
 * the downgrade reason so the user never believes they are confined when they are not.
 */
export function resolveSandboxPosture(opts: {
  mode: SandboxMode;
  detect?: () => BwrapDetection;
}): SandboxPosture {
  if (opts.mode === "danger-full-access") {
    return { mode: opts.mode, enforced: false, detail: "no confinement (danger-full-access)" };
  }
  const detection = (opts.detect ?? detectBwrapMemoizado)();
  if (!detection.ok) {
    return { mode: opts.mode, enforced: false, detail: `tool-gating only — ${detection.reason}` };
  }
  return { mode: opts.mode, enforced: true, detail: "kernel (bwrap)" };
}

export interface CreateSandboxBackendOptions {
  mode: SandboxMode;
  workDir?: string;
  network?: boolean;
  timeoutMs?: number;
  /** Injectable for tests; defaults to the real 3-probe detection. */
  detect?: () => BwrapDetection;
  /** Injectable for tests; defaults to console.warn. */
  warn?: (message: string) => void;
}

/**
 * Honest factory: bwrap available + mode wants confinement → `LinuxSandbox` (kernel enforcement,
 * running the VALIDATED absolute bin); `danger-full-access` → plain `LocalSandbox` silently (explicit
 * opt-out, `bwrap.rs:245-252`); bwrap unavailable → WARN once + `LocalSandbox` (the declarative M23
 * gating remains the guard). NEVER pretends to sandbox — the fallback is loud, mirroring Codex's
 * MISSING_BWRAP_WARNING. The durable posture lives in `resolveSandboxPosture` for the UI.
 */
export function createSandboxBackend(opts: CreateSandboxBackendOptions): SandboxBackend {
  const config: SandboxConfig = { workDir: opts.workDir, timeoutMs: opts.timeoutMs };
  if (opts.mode === "danger-full-access") return new LocalSandbox(config);

  const detection = (opts.detect ?? detectBwrapMemoizado)();
  if (!detection.ok) {
    if (!warnedUnavailable) {
      warnedUnavailable = true;
      const warn = opts.warn ?? ((m: string) => console.warn(redactSecrets(m)));
      warn(
        `[sandbox] OS-level enforcement unavailable (${detection.reason}) — ` +
          `falling back to tool-level gating only (sandbox_mode=${opts.mode}).`,
      );
    }
    return new LocalSandbox(config);
  }
  return new LinuxSandbox(config, { mode: opts.mode, network: opts.network, bin: detection.bin });
}

/**
 * M75 T3.2 — latch do aviso do caminho INTERATIVO.
 *
 * Separado do latch de `createSandboxBackend` de propósito: são duas decisões distintas, tomadas em
 * momentos distintos, e um usuário que só use shell interativo precisa ver o aviso mesmo que o
 * caminho não-interativo já o tenha emitido — senão a sessão em que ele realmente digita comandos
 * seria a única sem o alerta.
 */
let avisouInterativo = false;

/** Reset para testes — o latch é estado de módulo e testes precisam de isolamento. */
export function resetInteractiveWarnLatch(): void {
  avisouInterativo = false;
}

/**
 * A regra "seccomp SÓ com rede restrita" — em UM lugar.
 *
 * O Codex instala o filtro apenas quando a rede está fechada (`landlock.rs:96-117`), e não é
 * detalhe: o programa cBPF **nega as syscalls de rede** (`NETWORK_DENIED`). Aplicá-lo com a rede
 * liberada produz a pior combinação possível — o bwrap **permite** a rede (sem `--unshare-net`) e o
 * seccomp a **nega** com EPERM. O usuário pediu rede, recebeu o bind, e as chamadas morrem.
 *
 * Existia duplicada: o construtor decidia condicionalmente, `interactiveWrapCommand` instalava
 * incondicionalmente. Divergiam já na primeira versão (review de arquitetura do M75, provado em
 * runtime: `network:true` dava `--seccomp` no interativo e não no one-shot). Duas cópias de uma regra
 * de segurança não é duplicação de forma — é duplicação de CONHECIMENTO, e ela já tinha divergido.
 */
function seccompPathParaRede(redeLiberada: boolean): string | undefined {
  return redeLiberada ? undefined : restrictedSeccompPath();
}

export interface InteractiveWrapOptions {
  mode: SandboxMode;
  /** `true` mantém a rede. Default `false`, igual ao `run_shell` não-interativo. */
  network?: boolean;
  /** Injetável para testes; default é a detecção real memoizada. */
  detect?: () => BwrapDetection;
  /** Injetável para testes; default é `console.warn` com redação. */
  warn?: (message: string) => void;
}

/**
 * A composição que o caminho interativo precisa — o par de `createSandboxBackend`.
 *
 * `createSandboxBackend` resolve isto para o caminho não-interativo devolvendo um BACKEND pronto. O
 * PTY não aceita um backend: ele é dono do spawn e só admite transformar o comando. Esta função
 * entrega a MESMA decisão na forma que o PTY aceita — `(command, cwd) => string | null` —, pronta
 * para `new PtyInteractiveBackend({ wrapCommand: interactiveWrapCommand({ mode }) })`.
 *
 * A detecção é consultada **a cada wrap**, não congelada na construção: uma sessão interativa vive
 * por horas, e uma detecção positiva obsoleta continuaria afirmando confinamento depois de o binário
 * sumir (a revalidação por `existsSync` vive dentro de `detectBwrapMemoizado`).
 *
 * As duas rotas que devolvem `null` são semanticamente diferentes e o código não as funde:
 * `danger-full-access` é opt-out explícito e NÃO avisa; bwrap indisponível é falha e avisa uma vez.
 */
/**
 * A decisão de confinar ou degradar, separada do wrap em si.
 *
 * Extraída porque são duas responsabilidades e o gate de complexidade do SDK as separou por nós:
 * DECIDIR (há confinamento disponível? o usuário optou por sair?) e APLICAR (montar o argv). Manter
 * juntas fazia o closure passar de 10 de complexidade cognitiva — e o linter estava certo: a parte
 * que decide é a que tem consequência de segurança e merece ser lida sozinha.
 *
 * Devolve o binário validado quando há confinamento, ou `null` quando não há — avisando UMA vez, e
 * apenas quando a ausência é uma falha (não quando é opt-out).
 */
function decidirConfinamento(opts: InteractiveWrapOptions): string | null {
  if (opts.mode === "danger-full-access") return null;

  const detection = (opts.detect ?? detectBwrapMemoizado)();
  if (detection.ok) return detection.bin;

  if (!avisouInterativo) {
    avisouInterativo = true;
    const warn = opts.warn ?? ((m: string) => console.warn(redactSecrets(m)));
    warn(
      `[sandbox] OS-level enforcement unavailable (${detection.reason}) — interactive session ` +
        `runs WITHOUT kernel confinement (sandbox_mode=${opts.mode}).`,
    );
  }
  return null;
}

/**
 * A composição que o caminho interativo precisa — o par de `createSandboxBackend`.
 *
 * `createSandboxBackend` resolve isto para o caminho não-interativo devolvendo um BACKEND pronto. O
 * PTY não aceita um backend: ele é dono do spawn e só admite transformar o comando. Esta função
 * entrega a MESMA decisão na forma que o PTY aceita — `(command, cwd) => string | null`.
 *
 * A detecção é consultada **a cada wrap**, não congelada na construção: uma sessão interativa vive
 * por horas, e uma detecção positiva obsoleta continuaria afirmando confinamento depois de o binário
 * sumir.
 */
export function interactiveWrapCommand(
  opts: InteractiveWrapOptions,
): (command: string, cwd: string) => string | null {
  return (command: string, cwd: string): string | null => {
    const bin = decidirConfinamento(opts);
    if (bin === null) return null;

    return wrapCommandForSandbox(
      opts.mode,
      {
        cwd,
        network: opts.network ?? false,
        env: allowlistedEnv(),
        bin,
        seccompPath: seccompPathParaRede(opts.network ?? false),
      },
      command,
    );
  };
}
