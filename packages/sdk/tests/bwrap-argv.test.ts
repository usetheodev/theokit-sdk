// MIGRADO do agent-builder no M75 T4.1 — SEGUNDA tentativa, e a razao esta no review.
//
// A primeira "migracao" escreveu testes NOVOS com probes injetados e deletou estes 24. O review
// provou por MUTACAO o que isso custou: trocar buildSeccompFilter por `Buffer.alloc(8)` — um filtro
// que nao nega NADA, sem arch guard, sem ptrace, sem io_uring, sem AF_INET — passava 9/9. A
// semantica inteira do filtro cBPF estava vacua.
//
// Aqui a mudanca e SO no bloco de import (D4). Nenhum corpo, nenhuma assercao.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildBwrapArgv,
  detectBwrap,
  detectBwrapMemoizado,
  resetBwrapMemo,
} from "../src/sandbox/bwrap.js";

/**
 * M53 T0.1 — bwrap argv puro por policy + detecção honesta (3 sondas Codex-faithful:
 * which fora do cwd, `--help` ⊃ `--perms`, probe de user-namespace com timeout).
 * Flags espelham `codex-rs/linux-sandbox/src/bwrap.rs` (subconjunto sem seccomp 2-estágios).
 */

const CWD = "/home/u/proj";

describe("buildBwrapArgv", () => {
  it("workspace_write_argv_exact", () => {
    const argv = buildBwrapArgv("workspace-write", { cwd: CWD, gitDirExists: true });
    expect(argv).not.toBeNull();
    const a = argv!;
    // núcleo sempre presente (bwrap.rs:318-332,446-452)
    for (const flag of ["--new-session", "--die-with-parent", "--unshare-user", "--unshare-pid"]) {
      expect(a).toContain(flag);
    }
    expect(a.join(" ")).toContain("--ro-bind / /");
    expect(a.join(" ")).toContain("--dev /dev");
    expect(a.join(" ")).toContain("--proc /proc");
    // rede off por default (bwrap.rs:325-327)
    expect(a).toContain("--unshare-net");
    // writable roots: cwd + /tmp (protocol.rs:1189-1214)
    expect(a.join(" ")).toContain(`--bind ${CWD} ${CWD}`);
    expect(a.join(" ")).toContain("--bind /tmp /tmp");
    // .git protegido POR CIMA do bind RW (permissions.rs:22-31; bwrap.rs:571-597) — ordem importa
    const joined = a.join(" ");
    expect(joined).toContain(`--ro-bind ${CWD}/.git ${CWD}/.git`);
    expect(joined.indexOf(`--bind ${CWD} ${CWD}`)).toBeLessThan(
      joined.indexOf(`--ro-bind ${CWD}/.git`),
    );
    // termina no separador do comando
    expect(a[a.length - 1]).toBe("--");
  });

  it("workspace_write_without_git_dir_has_no_git_robind", () => {
    const a = buildBwrapArgv("workspace-write", { cwd: CWD, gitDirExists: false })!;
    expect(a.join(" ")).not.toContain(".git");
  });

  it("read_only_has_no_rw_binds", () => {
    const a = buildBwrapArgv("read-only", { cwd: CWD, gitDirExists: true })!;
    expect(a.join(" ")).toContain("--ro-bind / /");
    expect(a).not.toContain("--bind"); // zero writable roots (protocol.rs:1176)
    expect(a).toContain("--unshare-net");
  });

  it("danger_returns_null", () => {
    // danger-full-access pula o bwrap inteiramente (bwrap.rs:245-252)
    expect(buildBwrapArgv("danger-full-access", { cwd: CWD, gitDirExists: true })).toBeNull();
  });

  it("network_true_removes_unshare_net", () => {
    const a = buildBwrapArgv("workspace-write", { cwd: CWD, network: true, gitDirExists: false })!;
    expect(a).not.toContain("--unshare-net");
  });
});

describe("detectBwrap (fail-closed em cada sonda)", () => {
  const okProbes = {
    which: () => "/usr/bin/bwrap",
    helpText: () => "--perms --ro-bind --unshare-net",
    userns: () => true,
  };

  it("all_probes_pass_returns_bin", () => {
    expect(detectBwrap(okProbes)).toEqual({ ok: true, bin: "/usr/bin/bwrap" });
  });

  it("which_missing_fails_closed", () => {
    const r = detectBwrap({ ...okProbes, which: () => null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/not found/i);
  });

  it("help_without_perms_fails_closed", () => {
    // launcher.rs:108-124 — exige --perms
    const r = detectBwrap({ ...okProbes, helpText: () => "--ro-bind only" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/--perms/);
  });

  it("userns_denied_fails_closed", () => {
    // sandboxing/src/bwrap.rs:74-136 — probe ativo de user namespace
    const r = detectBwrap({ ...okProbes, userns: () => false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/namespace/i);
  });

  it("probes_never_throw_out", () => {
    const r = detectBwrap({
      which: () => {
        throw new Error("spawn EACCES");
      },
      helpText: okProbes.helpText,
      userns: okProbes.userns,
    });
    expect(r.ok).toBe(false);
  });
});

describe("M53 review fixes — env confinement + absolute bin", () => {
  it("clearenv_precedes_setenv_allowlist", () => {
    // MEDIUM-3: --clearenv (Codex env_clear) + re-inject só o allowlist, nunca herdar secrets por nome
    const a = buildBwrapArgv("workspace-write", {
      cwd: CWD,
      gitDirExists: false,
      env: { PATH: "/usr/bin", HOME: "/home/u" },
    })!;
    const joined = a.join(" ");
    expect(a).toContain("--clearenv");
    // --clearenv ANTES de qualquer --setenv (senão o clear apaga o que foi setado)
    expect(a.indexOf("--clearenv")).toBeLessThan(a.indexOf("--setenv"));
    expect(joined).toContain("--setenv PATH /usr/bin");
    expect(joined).toContain("--setenv HOME /home/u");
    // flag de rede continua presente (rede off default)
    expect(joined).toContain("--setenv CODEX_SANDBOX_NETWORK_DISABLED 1");
  });

  it("no_clearenv_when_env_absent (retrocompat)", () => {
    const a = buildBwrapArgv("read-only", { cwd: CWD, gitDirExists: false })!;
    expect(a).not.toContain("--clearenv");
  });
});

/**
 * M71 T1.1 — a sondagem roda uma vez por PROCESSO, não por turno.
 *
 * Medido antes: `detectBwrap()` custa **22,2 ms** e não era memoizada — a segunda chamada custava
 * 19,4 ms. `buildChatAgent` no caminho headless disparava **duas** (via `createSandboxBackend` e via
 * `resolveSandboxPosture`, que o M70 acrescentou), somando 46,4 ms por construção. Em `strace`, ~90%
 * dos 182 syscalls de uma construção aquecida vinham daqui.
 *
 * **Por que sem invalidação.** O milestone mandava invalidar no `SessionStart`, mas
 * `agents/lib/hooks/hooks.ts:28-30` documenta — como correção MEDIDA de uma suposição anterior — que
 * esse evento dispara **uma vez por TURNO**. Invalidar ali re-sondaria a cada turno, ou seja, seria
 * exatamente o comportamento que este teste existe para eliminar. A referência também não invalida:
 * seu único cache é um `OnceLock` write-once (`linux-sandbox/src/launcher.rs:52`).
 *
 * O preço, dito na cara: `bwrap` instalado DEPOIS do processo começar não é detectado até reiniciar.
 */
describe("M71 T1.1 — memoização por processo", () => {
  it("test_detectBwrap_sonda_uma_vez_so", () => {
    resetBwrapMemo();
    let sondas = 0;
    const probes = {
      which: () => {
        sondas++;
        return "/usr/bin/bwrap";
      },
      helpText: () => "--perms",
      userns: () => true,
    };
    // O memo vale para os probes REAIS. Com probes injetados (teste), cada chamada sonda — senão um
    // teste envenenaria o cache do processo para todos os outros.
    detectBwrap(probes);
    detectBwrap(probes);
    expect(sondas, "probes injetados não devem ser memoizados").toBe(2);

    resetBwrapMemo();
    let reais = 0;
    const comoSeFosseReal = {
      which: () => {
        reais++;
        return null;
      },
      helpText: () => null,
      userns: () => false,
    };
    detectBwrapMemoizado(comoSeFosseReal);
    detectBwrapMemoizado(comoSeFosseReal);
    detectBwrapMemoizado(comoSeFosseReal);
    expect(reais, "a sondagem memoizada deve rodar UMA vez").toBe(1);
  });

  it("test_a_segunda_chamada_e_praticamente_gratis", () => {
    resetBwrapMemo();
    const probes = { which: () => "/usr/bin/bwrap", helpText: () => "--perms", userns: () => true };
    detectBwrapMemoizado(probes);
    const t = performance.now();
    for (let i = 0; i < 100; i++) detectBwrapMemoizado(probes);
    const ms = (performance.now() - t) / 100;
    expect(ms, `segunda chamada custou ${ms.toFixed(3)}ms`).toBeLessThan(1);
  });

  it("test_o_memo_preserva_o_resultado_negativo", () => {
    // Fail-closed também é resultado: um host SEM bwrap não pode re-sondar por turno só porque a
    // resposta foi "não".
    resetBwrapMemo();
    let n = 0;
    const semBwrap = {
      which: () => {
        n++;
        return null;
      },
      helpText: () => null,
      userns: () => false,
    };
    const a = detectBwrapMemoizado(semBwrap);
    const b = detectBwrapMemoizado(semBwrap);
    expect(a.ok).toBe(false);
    expect(b).toEqual(a);
    expect(n).toBe(1);
  });

  /**
   * Review F-perf-9 — o sentido do memo obsoleto que o m71-custo-por-turn#ADR-1 original não declarou, e o único com
   * consequência de segurança: o binário validado some do host DEPOIS da detecção.
   *
   * Sem revalidação, a postura seguiria afirmando `enforced: true / "kernel (bwrap)"` pelo processo
   * inteiro e o veto do M70 aprovaria tool gateada citando um confinamento que não existe mais — o
   * defeito que o M70 corrigiu, reintroduzido pela memoização do M71.
   */
  it("test_o_memo_rebaixa_o_positivo_quando_o_binario_some_do_host", () => {
    const dir = mkdtempSync(join(tmpdir(), "m71-bwrap-"));
    const bin = join(dir, "bwrap");
    writeFileSync(bin, "#!/bin/sh\n");
    resetBwrapMemo();
    const probes = { which: () => bin, helpText: () => "--perms", userns: () => true };

    expect(detectBwrapMemoizado(probes)).toEqual({ ok: true, bin });

    rmSync(bin); // o operador removeu/renomeou o bwrap no meio da sessão

    const depois = detectBwrapMemoizado(probes);
    expect(depois.ok, "o memo seguiu afirmando confinamento de kernel sem o binário").toBe(false);
    expect(depois.ok === false && depois.reason).toMatch(/disappeared/);
  });

  it("test_a_revalidacao_nao_re_sonda", () => {
    // A revalidação é 1 syscall, não a sondagem de 22,2ms que a memoização existe para eliminar.
    const dir = mkdtempSync(join(tmpdir(), "m71-bwrap-"));
    const bin = join(dir, "bwrap");
    writeFileSync(bin, "#!/bin/sh\n");
    resetBwrapMemo();
    let n = 0;
    const probes = {
      which: () => {
        n++;
        return bin;
      },
      helpText: () => "--perms",
      userns: () => true,
    };
    for (let i = 0; i < 50; i++) detectBwrapMemoizado(probes);
    expect(n, "a revalidação virou re-sondagem — o ganho do M71 morreu").toBe(1);
  });

  it("test_o_reset_existe_e_e_explicito", () => {
    resetBwrapMemo();
    let n = 0;
    const p = {
      which: () => {
        n++;
        return null;
      },
      helpText: () => null,
      userns: () => false,
    };
    detectBwrapMemoizado(p);
    resetBwrapMemo();
    detectBwrapMemoizado(p);
    expect(n, "o reset é o seam do TESTE — produção nunca o chama").toBe(2);
  });
});
