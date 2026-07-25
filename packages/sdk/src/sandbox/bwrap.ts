// Promovido do agent-builder no M75 (plano m75-sandbox-kernel-no-framework, D1): confinamento de
// kernel e infraestrutura do framework, nao do consumidor. Custo medido da promocao: ZERO
// dependencias — so node:child_process, node:fs e node:path. O filtro cBPF e um Buffer em JS puro.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * M53 — bubblewrap argv + honest detection, faithful to Codex's Linux sandbox
 * (`codex-rs/linux-sandbox/src/bwrap.rs` + `codex-rs/sandboxing/src/bwrap.rs`).
 *
 * HONEST SCOPE: filesystem confinement + network isolation via bwrap, PLUS the second stage —
 * a cBPF seccomp syscall filter (`agents/sandbox/seccomp.ts`), wired in `agents/sandbox/backend.ts`
 * via `restrictedSeccompPath()`. Portado no M63; este bloco afirmava o contrário até o M67 e
 * SUBDECLARAVA a postura de segurança real. Limite honesto que permanece: o filtro é **x86_64**
 * (guarda de arquitetura recusa instalar em outra arch, com WARN, e o confinamento de FS/rede do
 * bwrap segue valendo) **e** só é instalado quando a rede está restrita (`backend.ts:87`, fiel a
 * `landlock.rs:96-117`): com rede ligada não há filtro de syscall, apenas o confinamento de FS do
 * bwrap. `danger-full-access` pula o bwrap por completo, espelhando `bwrap.rs:245-252`.
 * Deltas versus o Codex seguem documentados em docs/CODEX-PARITY.md.
 */

/**
 * Os tres modos canonicos do Codex. Definidos AQUI porque sao vocabulario do sandbox, nao da
 * configuracao do consumidor: `danger-full-access` significa "nao embrulhe", e essa e uma decisao do
 * subsistema de confinamento.
 */
export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";

export interface BwrapArgvOptions {
  /** Workspace root — the single RW bind under `workspace-write` (protocol.rs:1189-1200). */
  cwd: string;
  /** `true` removes `--unshare-net` (policy `network_access`, default false). */
  network?: boolean;
  /** Injectable for tests; defaults to a real `existsSync` check on `<cwd>/.git`. */
  gitDirExists?: boolean;
  /**
   * When present, emit `--clearenv` and re-inject ONLY these vars (Codex env_clear model,
   * `exec_env.rs:25-31`). Closes the denylist gap: a secret in an oddly-named var never reaches the
   * sandboxed child. Omitted ⇒ inherit the parent env (backward-compatible; SDK scrub still applies).
   */
  env?: Record<string, string>;
}

/**
 * Pure argv builder. Returns the bwrap flags ending in `--` (caller appends `/bin/sh -c <cmd>`),
 * or `null` when the policy skips the sandbox entirely (`danger-full-access`).
 */
export function buildBwrapArgv(mode: SandboxMode, opts: BwrapArgvOptions): string[] | null {
  if (mode === "danger-full-access") return null; // bwrap skipped entirely (bwrap.rs:245-252)

  const cwd = path.resolve(opts.cwd);
  const gitDir = path.join(cwd, ".git");
  const hasGit = opts.gitDirExists ?? existsSync(gitDir);

  const argv: string[] = [
    // core, always (bwrap.rs:318-332; user+pid namespaces explicit so it works as root in containers)
    "--new-session",
    "--die-with-parent",
    "--unshare-user",
    "--unshare-pid",
    // full-read filesystem base (bwrap.rs:446-452)
    "--ro-bind",
    "/",
    "/",
    "--dev",
    "/dev",
    "--proc",
    "/proc",
  ];

  if (!opts.network) argv.push("--unshare-net"); // network off by default (bwrap.rs:325-327)

  // env confinement — `--clearenv` MUST precede every `--setenv` or the clear wipes them
  // (exec_env.rs:25-31 clears then rebuilds). Only when an explicit allowlist is provided.
  if (opts.env) argv.push("--clearenv");
  const setenv: Record<string, string> = {
    ...(opts.env ?? {}),
    // the flag signals the child that network is unshared (spawn.rs:20,79)
    ...(opts.network ? {} : { CODEX_SANDBOX_NETWORK_DISABLED: "1" }),
  };
  for (const [k, v] of Object.entries(setenv)) argv.push("--setenv", k, v);

  if (mode === "workspace-write") {
    // writable roots: cwd + /tmp (protocol.rs:1189-1214)
    argv.push("--bind", cwd, cwd, "--bind", "/tmp", "/tmp");
    // metadata protection ON TOP of the RW bind — order matters (permissions.rs:22-31; bwrap.rs:571-597)
    if (hasGit) argv.push("--ro-bind", gitDir, gitDir);
  }
  // read-only: zero writable roots (protocol.rs:1176) — nothing to add

  argv.push("--chdir", cwd, "--");
  return argv;
}

/** Injectable probes — each mirrors one Codex availability check. */
export interface BwrapProbes {
  /** `which bwrap` outside the cwd (anti-hijack, sandboxing/src/bwrap.rs:168-191). */
  which: () => string | null;
  /** `bwrap --help` text — must advertise `--perms` (launcher.rs:108-124). */
  helpText: (bin: string) => string | null;
  /** Active user-namespace probe with timeout (sandboxing/src/bwrap.rs:74-136). */
  userns: (bin: string) => boolean;
}

export type BwrapDetection = { ok: true; bin: string } | { ok: false; reason: string };

/** Honest detection — fail-closed on every probe; NEVER throws (callers WARN + fall back). */
export function detectBwrap(probes: BwrapProbes = realProbes): BwrapDetection {
  try {
    const bin = probes.which();
    if (!bin) return { ok: false, reason: "bwrap not found in PATH" };
    const help = probes.helpText(bin);
    if (!help?.includes("--perms")) {
      return { ok: false, reason: `bwrap at ${bin} lacks --perms support (too old)` };
    }
    if (!probes.userns(bin)) {
      return { ok: false, reason: "user namespaces unavailable (container/kernel restriction)" };
    }
    return { ok: true, bin };
  } catch (err) {
    return {
      ok: false,
      reason: `bwrap probe failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Quantas vezes a sondagem REAL rodou neste processo.
 *
 * Instrumentado aqui, e não num wrapper, porque é aqui que o custo está: cada `which` dispara um
 * subprocesso (`which bwrap`), e a sondagem completa custava 22,2 ms. Um gate que conta probes
 * INJETADOS não vê a sondagem real — foi o primeiro erro do gate do M71, e um mutante o expôs.
 */
let sondagensReais = 0;

/** Quantas sondagens reais rodaram. Seam de TESTE — o gate de performance conta isto. */
export function realProbeCount(): number {
  return sondagensReais;
}

/** Real probes used in production. */
export const realProbes: BwrapProbes = {
  which: () => {
    sondagensReais++;
    try {
      const out = execFileSync("which", ["bwrap"], { encoding: "utf8", timeout: 2_000 }).trim();
      // anti-hijack: never accept a bwrap that lives inside the workspace (bwrap.rs:168-191)
      if (!out || out.startsWith(process.cwd() + path.sep)) return null;
      return out;
    } catch {
      return null;
    }
  },
  helpText: (bin) => {
    try {
      // bwrap --help exits 0/1 depending on version; capture output either way
      return execFileSync(bin, ["--help"], { encoding: "utf8", timeout: 2_000 });
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string };
      return [e.stdout, e.stderr].filter(Boolean).join("\n") || null;
    }
  },
  userns: (bin) => {
    try {
      // active probe, 500ms budget like Codex (sandboxing/src/bwrap.rs:74-136)
      execFileSync(bin, ["--unshare-user", "--unshare-net", "--ro-bind", "/", "/", "/bin/true"], {
        timeout: 500,
        stdio: "ignore",
      });
      return true;
    } catch {
      return false;
    }
  },
};

/**
 * O resultado da sondagem, memoizado pelo tempo de vida do PROCESSO.
 *
 * Medido antes do M71: `detectBwrap()` custa **22,2 ms** e não era memoizada — a segunda chamada
 * custava 19,4 ms. `buildChatAgent` no caminho headless disparava **duas** (uma por
 * `createSandboxBackend`, outra por `resolveSandboxPosture`, que o M70 acrescentou), somando 46,4 ms
 * por construção — e a construção acontece por turno. Em `strace`, ~90% dos 182 syscalls de uma
 * construção já aquecida vinham daqui: `which` varrendo o PATH, `/proc/filesystems`, `/newroot`, e os
 * `.so` que os dois subprocessos de sonda carregam.
 *
 * ## Por que sem invalidação
 *
 * O milestone mandava invalidar no `SessionStart`. Não funciona: `agents/lib/hooks/hooks.ts:28-30`
 * documenta — como correção **medida** de uma suposição anterior — que esse evento dispara **uma vez
 * por TURNO**, não por sessão. Invalidar ali re-sondaria a cada turno, exatamente o comportamento que
 * a memoização existe para eliminar.
 *
 * A referência também não invalida: o único cache real do Codex é um `OnceLock` write-once
 * (`codex-rs/linux-sandbox/src/launcher.rs:52`), e sua sondagem cara roda uma vez por processo,
 * apenas para imprimir um aviso de UI (`sandboxing/src/bwrap.rs:40-72`).
 *
 * **O preço, dito na cara — nos DOIS sentidos.** O m71-custo-por-turn#ADR-1 original só declarou um deles; o review do
 * M71 (F-perf-9) mostrou que o omitido era justamente o que tem consequência de segurança:
 *
 * - **Negativo obsoleto** (`bwrap` instalado DEPOIS): não é detectado até reiniciar. O sistema falha
 *   FECHADO — a postura reporta `enforced: false` e o veto do M70 **recusa**. Custo: irritação (a
 *   mensagem manda instalar o bwrap que a pessoa acabou de instalar). Aceito.
 * - **Positivo obsoleto** (`bwrap` removido/renomeado DEPOIS): a postura continuaria afirmando
 *   `enforced: true / "kernel (bwrap)"` e o veto **aprovaria** citando um confinamento que já não
 *   existe. Isso é a reintrodução literal do defeito que o M70 corrigiu — *"dizer ao operador que ele
 *   está protegido quando não está é pior do que não dizer nada"*. Antes do M71 a re-sondagem por
 *   turno fechava essa janela no turno seguinte; a memoização a deixaria aberta pelo processo inteiro.
 *   **Por isso o positivo é revalidado** abaixo, a 1 syscall — 3 ordens de grandeza abaixo dos 22,2 ms
 *   da sondagem completa, que é o custo que a memoização existe para eliminar.
 */
let memo: BwrapDetection | undefined;

/**
 * `detectBwrap` com memoização — o que a produção deve chamar.
 *
 * Note que `detectBwrap` em si **não** memoiza, de propósito: ele aceita probes injetados, e memoizar
 * ali faria um teste com probes falsos envenenar o cache do processo para todos os outros.
 *
 * A revalidação do positivo NÃO é uma re-sondagem: `detectBwrap` gasta três probes (subprocesso
 * `which` + `--help` + namespace de usuário). Aqui só se confirma que o binário validado continua no
 * lugar. Se sumiu, o memo é rebaixado a negativo com o motivo dito — nunca promovido a positivo, que
 * exigiria a sondagem cara de volta.
 */
export function detectBwrapMemoizado(probes: BwrapProbes = realProbes): BwrapDetection {
  memo ??= detectBwrap(probes);
  if (memo.ok && !existsSync(memo.bin)) {
    memo = { ok: false, reason: `bwrap disappeared from ${memo.bin} after detection` };
  }
  return memo;
}

/** Seam de TESTE — limpa o memo. Produção nunca chama (ver m71-custo-por-turn#ADR-1). */
export function resetBwrapMemo(): void {
  memo = undefined;
}
