/**
 * M75 T2.2 — `LinuxSandbox` + o wrap + a postura, promovidos do agent-builder.
 *
 * ## Por que cabe no contrato sem breaking
 *
 * `SandboxBackend` declara exatamente 2 abstratos (`execute`, `uploadFile`); `readFile`/`writeFile`/
 * `glob`/`grep` são concretos sobre `execute`. `LinuxSandbox` só faz `override execute` — o método
 * **já abstrato** — e **adiciona** `wrapCommand`. Nenhum membro falta, então promover não força major.
 *
 * ## O que estes testes protegem, e que não é obvio
 *
 * O valor deste subsistema não está em confinar quando dá certo — está em **NUNCA fingir** quando dá
 * errado. Três caminhos de degradação honesta são testados aqui como caso negativo, com o erro/aviso
 * específico, não com "não lançou": bwrap ausente, `danger-full-access` (opt-out explícito, que NÃO
 * é anomalia e por isso não avisa) e arquitetura não-x86_64 (o filtro cBPF mataria todo syscall).
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
    // O comando cruza UM `/bin/sh -c` extra: a citação tem de sobreviver, senão um comando com
    // aspas simples viraria outro comando dentro do sandbox.
    expect(w).toContain("/bin/sh -c");
    expect(w).toContain("--unshare-net");
  });

  it("test_danger_full_access_devolve_null", () => {
    // `null` = "não embrulhe". Devolver o comando cru confundiria as duas coisas no chamador.
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
    // O programa entra por redirecionamento de fd 3 — é assim que o bwrap o lê.
    expect(com).toContain("--seccomp");
    expect(com).toContain("3< ");
  });
});

describe("M75 T2.2 — allowlistedEnv", () => {
  it("test_reinjeta_apenas_o_permitido_e_descarta_o_resto", () => {
    // Modelo env_clear do Codex: o filho recebe o que precisa para rodar um shell, nunca o env do pai
    // — que pode ter um segredo com nome que nenhuma heurística de nome pega.
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

describe("M75 T2.2 — degradação honesta (casos negativos)", () => {
  it("test_bwrap_ausente_avisa_UMA_vez_e_devolve_backend_sem_confinamento", () => {
    resetSandboxWarnLatch();
    const avisos: string[] = [];
    const opts = {
      mode: "workspace-write" as const,
      detect: detectaFalha,
      warn: (m: string) => avisos.push(m),
    };
    const a = createSandboxBackend(opts);
    const b = createSandboxBackend(opts);

    expect(a).toBeInstanceOf(SandboxBackend);
    expect(b).toBeInstanceOf(SandboxBackend);
    // Nenhum dos dois é LinuxSandbox: sem bwrap não há confinamento, e fingir seria o pior resultado.
    expect(a).not.toBeInstanceOf(LinuxSandbox);
    // UMA vez: o aviso é para o humano, e repeti-lo a cada tool call vira ruído que ninguém lê.
    expect(avisos, "o aviso repetiu — vira ruído e deixa de ser lido").toHaveLength(1);
    expect(avisos[0], "o aviso precisa dizer POR QUE e em que modo").toMatch(
      /PATH.*workspace-write/s,
    );
  });

  it("test_danger_full_access_nao_avisa_porque_e_opt_out_explicito", () => {
    resetSandboxWarnLatch();
    const avisos: string[] = [];
    const s = createSandboxBackend({
      mode: "danger-full-access",
      detect: detectaFalha,
      warn: (m: string) => avisos.push(m),
    });
    expect(s).not.toBeInstanceOf(LinuxSandbox);
    // A distinção que importa: "o usuário desligou" não é anomalia; "não consegui ligar" é.
    expect(avisos, "opt-out explícito não é anomalia e não deve avisar").toHaveLength(0);
  });

  it("test_arquitetura_nao_x64_recusa_seccomp_e_avisa", () => {
    // ARCH GUARD: o programa cBPF é x86_64 e seu guard MATA todo syscall de outra arquitetura — o
    // primeiro execve morreria, e silenciosamente, porque a geração funciona e o bwrap aceita.
    const avisos: string[] = [];
    const p = seccompPathForArch("arm64", (m) => avisos.push(m));
    expect(p, "em arm64 nenhum caminho de seccomp pode ser devolvido").toBeUndefined();
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatch(/x86_64|x64/i);
  });
});

describe("M75 T2.2 — resolveSandboxPosture", () => {
  it("test_confinado_diz_kernel", () => {
    const p = resolveSandboxPosture({ mode: "workspace-write", detect: detectaOk });
    expect(p.enforced).toBe(true);
    expect(p.detail).toMatch(/kernel/i);
  });

  it("test_sem_bwrap_diz_nao_confinado_COM_o_motivo", () => {
    // A postura é o que a UI mostra. "não confinado" sem motivo deixa o usuário sem ação; com o
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
