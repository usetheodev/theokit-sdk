/**
 * M75 T2.2 — `LinuxSandbox` + o wrap + a postura, promovidos do agent-builder.
 *
 * ## Por que cabe no contrato sem breaking
 *
 * `SandboxBackend` declara exatamente 2 abstratos (`execute`, `uploadFile`); `readFile`/`writeFile`/
 * `glob`/`grep` are concrete over `execute`. `LinuxSandbox` only does `override execute` — the method
 * **already abstract** — and **adds** `wrapCommand`. No member is missing, so promoting forces no major.
 *
 * ## What these tests protect, which is not obvious
 *
 * This subsystem's value is not in confining when things go right — it is in **NEVER pretending**
 * when they go wrong. Three honest-degradation paths are tested here as negative cases, asserting
 * the specific error/warning rather than "it did not throw": bwrap absent, `danger-full-access` (an
 * explicit opt-out, which is NOT an anomaly and therefore does not warn), and a non-x86_64
 * architecture (where the cBPF filter would kill every syscall).
 */
import { describe, expect, it } from "vitest";

import {
  allowlistedEnv,
  type BwrapDetection,
  createSandboxBackend,
  LinuxSandbox,
  resetSandboxWarnLatch,
  resolveSandboxPosture,
  SandboxBackend,
  seccompPathForArch,
  wrapCommandForSandbox,
} from "../src/sandbox/index.js";

const detectaOk = (): BwrapDetection => ({ ok: true, bin: "/usr/bin/bwrap" });
const detectaFalha = (): BwrapDetection => ({ ok: false, reason: "bwrap not found in PATH" });

describe("M75 T2.2 — wrapCommandForSandbox", () => {
  it("test_embrulha_com_bwrap_e_preserva_o_comando_entre_aspas", () => {
    const w = wrapCommandForSandbox(
      "workspace-write",
      { cwd: "/w", network: false, env: {}, bin: "/usr/bin/bwrap" },
      "echo 'oi'",
    );
    expect(w).not.toBeNull();
    // The command crosses ONE extra `/bin/sh -c`: the quoting must survive, otherwise a command with
    // aspas simples viraria outro comando dentro do sandbox.
    expect(w).toContain("/bin/sh -c");
    expect(w).toContain("--unshare-net");
  });

  it("test_danger_full_access_devolve_null", () => {
    // `null` = "do not wrap". Returning the raw command would conflate the two in the caller.
    expect(
      wrapCommandForSandbox("danger-full-access", { cwd: "/w", env: {} }, "echo oi"),
    ).toBeNull();
  });

  it("test_seccomp_so_entra_quando_ha_caminho", () => {
    const sem = wrapCommandForSandbox("workspace-write", { cwd: "/w", env: {} }, "true");
    const com = wrapCommandForSandbox(
      "workspace-write",
      { cwd: "/w", env: {}, seccompPath: "/tmp/f.bpf" },
      "true",
    );
    expect(sem).not.toContain("--seccomp");
    // The program comes in via an fd 3 redirect — that is how bwrap reads it.
    expect(com).toContain("--seccomp");
    expect(com).toContain("3< ");
  });
});

describe("M75 T2.2 — allowlistedEnv", () => {
  it("test_reinjeta_apenas_o_permitido_e_descarta_o_resto", () => {
    // Modelo env_clear do Codex: o filho recebe o que precisa para rodar um shell, nunca o env do pai
    // — which may hold a secret under a name no name-based heuristic catches.
    const env = allowlistedEnv({ PATH: "/bin", MINHA_CHAVE_ESQUISITA: "s3cr3t", HOME: "/h" });
    expect(env).toEqual({ PATH: "/bin", HOME: "/h" });
    expect(Object.values(env)).not.toContain("s3cr3t");
  });
});

describe("M75 T2.2 — LinuxSandbox", () => {
  it("test_e_um_sandbox_backend_do_contrato", () => {
    const s = new LinuxSandbox(
      { workDir: "/w" },
      { mode: "workspace-write", bin: "/usr/bin/bwrap" },
    );
    expect(s).toBeInstanceOf(SandboxBackend);
  });

  it("test_wrap_command_do_objeto_usa_o_modo_da_construcao", () => {
    const s = new LinuxSandbox(
      { workDir: "/w" },
      { mode: "workspace-write", bin: "/usr/bin/bwrap" },
    );
    expect(s.wrapCommand("true")).toContain("--unshare-net");

    const livre = new LinuxSandbox({ workDir: "/w" }, { mode: "danger-full-access" });
    expect(livre.wrapCommand("true")).toBeNull();
  });
});

describe("M75 T2.2 — honest degradation (negative cases)", () => {
  it("test_bwrap_ausente_avisa_UMA_vez_e_devolve_backend_sem_confinamento", () => {
    resetSandboxWarnLatch();
    const warnings: string[] = [];
    const opts = {
      mode: "workspace-write" as const,
      detect: detectaFalha,
      warn: (m: string) => warnings.push(m),
    };
    const a = createSandboxBackend(opts);
    const b = createSandboxBackend(opts);

    expect(a).toBeInstanceOf(SandboxBackend);
    expect(b).toBeInstanceOf(SandboxBackend);
    // Neither is a LinuxSandbox: without bwrap there is no confinement, and pretending would be the worst outcome.
    expect(a).not.toBeInstanceOf(LinuxSandbox);
    // ONCE: the warning is for the human, and repeating it on every tool call becomes noise nobody reads.
    expect(warnings, "the warning repeated — it becomes noise and stops being read").toHaveLength(
      1,
    );
    expect(warnings[0], "o aviso precisa dizer POR QUE e em que modo").toMatch(
      /PATH.*workspace-write/s,
    );
  });

  it("test_danger_full_access_nao_avisa_porque_e_opt_out_explicito", () => {
    resetSandboxWarnLatch();
    const warnings: string[] = [];
    const s = createSandboxBackend({
      mode: "danger-full-access",
      detect: detectaFalha,
      warn: (m: string) => warnings.push(m),
    });
    expect(s).not.toBeInstanceOf(LinuxSandbox);
    // The distinction that matters: "the user turned it off" is not an anomaly; "I could not turn it on" is.
    expect(warnings, "an explicit opt-out is not an anomaly and must not warn").toHaveLength(0);
  });

  it("test_arquitetura_nao_x64_recusa_seccomp_e_avisa", () => {
    // ARCH GUARD: the cBPF program is x86_64 and its guard KILLS every syscall from another
    // architecture — the first execve would die, and silently, because generation works and bwrap
    // accepts it.
    const warnings: string[] = [];
    const p = seccompPathForArch("arm64", (m) => warnings.push(m));
    expect(p, "em arm64 nenhum caminho de seccomp pode ser devolvido").toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/x86_64|x64/i);
  });
});

describe("M75 T2.2 — resolveSandboxPosture", () => {
  it("test_confinado_diz_kernel", () => {
    const p = resolveSandboxPosture({ mode: "workspace-write", detect: detectaOk });
    expect(p.enforced).toBe(true);
    expect(p.detail).toMatch(/kernel/i);
  });

  it("test_sem_bwrap_diz_nao_confinado_COM_o_motivo", () => {
    // The posture is what the UI shows. "not confined" without a reason leaves the user with no action; with the
    // motivo ele sabe se instala o bwrap ou se mudou de modo.
    const p = resolveSandboxPosture({ mode: "workspace-write", detect: detectaFalha });
    expect(p.enforced).toBe(false);
    expect(p.detail).toContain("PATH");
  });

  it("test_danger_full_access_e_honestamente_nao_confinado", () => {
    const p = resolveSandboxPosture({ mode: "danger-full-access", detect: detectaOk });
    expect(p.enforced, "danger-full-access nunca pode reportar confinamento").toBe(false);
  });
});
