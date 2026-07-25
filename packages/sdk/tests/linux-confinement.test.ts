/**
 * M75 T2.1 — as funções puras do confinamento de kernel, promovidas do agent-builder.
 *
 * ## Por que promover
 *
 * `buildBwrapArgv`, `detectBwrap` e `buildSeccompFilter` não têm nada de específico do agent-builder:
 * são a infraestrutura que **todo** consumidor do theokit que rode comandos vai reimplementar. Custo
 * medido da promoção: **zero dependências** — só `node:child_process`, `node:fs` e `node:path`; o
 * filtro cBPF é um `Buffer` construído em JS puro, sem `seccompiler` e sem binding nativo.
 *
 * ## Por que este arquivo é RED antes de existir o código
 *
 * Os módulos ainda não existem. A importação falha, e é isso que prova que o teste mede o código
 * promovido — não uma reimplementação local que passaria sozinha.
 *
 * ## O que este arquivo NÃO substitui
 *
 * Os 24 testes originais (`bwrap.test.ts` 18 + `seccomp.test.ts` 6) migram inteiros em T4.1, com
 * mudança **apenas** em linhas de `import` (D4 do plano). Este arquivo é o RED da promoção, não a
 * suíte de paridade — confundir os dois deixaria a migração sem oráculo.
 */
import { describe, expect, it } from "vitest";

import {
  type BwrapProbes,
  buildBwrapArgv,
  buildSeccompFilter,
  detectBwrap,
  resetBwrapMemo,
} from "../src/sandbox/index.js";

/** Probes injetáveis: nenhum teste deste arquivo toca o host. */
const probesFalsos = (over: Partial<BwrapProbes> = {}): BwrapProbes => ({
  which: () => "/usr/bin/bwrap",
  helpText: () => "--perms\n--ro-bind\n--unshare-user",
  userns: () => true,
  ...over,
});

describe("M75 T2.1 — buildBwrapArgv promovido", () => {
  it("test_workspace_write_confina_fs_e_rede", () => {
    const argv = buildBwrapArgv("workspace-write", {
      cwd: "/w",
      network: false,
      env: {},
    });
    expect(argv, "workspace-write deve produzir argv, não null").not.toBeNull();
    const s = (argv ?? []).join(" ");
    // Disco todo read-only, cwd read-write, rede fora — os três invariantes do modo.
    expect(s).toContain("--ro-bind / /");
    expect(s).toContain("--bind /w /w");
    expect(s).toContain("--unshare-net");
  });

  it("test_danger_full_access_nao_embrulha", () => {
    // `null` é o contrato de "não embrulhe" — opt-out explícito, não anomalia. Devolver um argv
    // vazio confundiria "sem confinamento" com "confinamento sem flags".
    expect(buildBwrapArgv("danger-full-access", { cwd: "/w", network: true, env: {} })).toBeNull();
  });

  it("test_read_only_nao_da_escrita_nem_no_cwd", () => {
    const s = (buildBwrapArgv("read-only", { cwd: "/w", network: false, env: {} }) ?? []).join(" ");
    expect(s).toContain("--ro-bind / /");
    expect(s, "read-only não pode conter --bind do cwd").not.toContain("--bind /w /w");
  });
});

describe("M75 T2.1 — detectBwrap promovido", () => {
  it("test_detecta_quando_todas_as_sondas_passam", () => {
    expect(detectBwrap(probesFalsos())).toEqual({ ok: true, bin: "/usr/bin/bwrap" });
  });

  it("test_userns_bloqueado_e_falha_honesta_com_motivo", () => {
    // Foi exatamente este caminho que o CI do agent-builder exercitou: bubblewrap instalado, userns
    // bloqueado pelo AppArmor do Ubuntu 24.04. O contrato é degradar com MOTIVO — nunca fingir.
    const d = detectBwrap(probesFalsos({ userns: () => false }));
    expect(d.ok).toBe(false);
    expect(d.ok === false && d.reason, "a falha precisa dizer POR QUE").toMatch(/namespace/i);
  });

  it("test_which_nulo_e_falha_honesta", () => {
    // O anti-hijack (recusar um `bwrap` que vive dentro do workspace) mora DENTRO de
    // `realProbes.which`, não em `detectBwrap` — injetar um probe falso o contornaria, e um teste que
    // o "verifica" por probe injetado estaria medindo a própria fixture. Ele é coberto pelos 18
    // testes de `bwrap.test.ts`, que migram intactos em T4.1. Aqui o que se mede é o contrato de
    // `detectBwrap` diante de um `which` que não resolveu.
    const d = detectBwrap(probesFalsos({ which: () => null }));
    expect(d.ok).toBe(false);
    expect(d.ok === false && d.reason).toMatch(/PATH|found/i);
  });
});

describe("M75 T2.1 — buildSeccompFilter promovido", () => {
  it("test_gera_programa_cbpf_como_buffer_sem_dependencia_nativa", () => {
    const f = buildSeccompFilter({ networkRestricted: true });
    expect(Buffer.isBuffer(f)).toBe(true);
    // Cada instrução cBPF ocupa 8 bytes; um programa válido é múltiplo de 8 e não é vazio.
    expect(f.length).toBeGreaterThan(0);
    expect(f.length % 8, "programa cBPF deve ser múltiplo de 8 bytes").toBe(0);
  });

  it("test_dois_builds_com_a_mesma_entrada_sao_byte_identicos", () => {
    // Determinismo é o que permite escrever o programa UMA vez por processo e reusar o caminho.
    expect(
      buildSeccompFilter({ networkRestricted: true }).equals(
        buildSeccompFilter({ networkRestricted: true }),
      ),
    ).toBe(true);
  });
});

describe("M75 T2.1 — o memo de detecção", () => {
  it("test_memo_e_concurrent_test_com_atomic_counter_invariant", async () => {
    // Estado de módulo compartilhado (`let memo`) é sinal de concorrência. O invariante é contagem de
    // CAUSA — quantas sondagens reais aconteceram — e não tempo de parede: não pisca sob carga.
    const { detectBwrapMemoizado } = await import("../src/sandbox/index.js");
    resetBwrapMemo();
    // O contador tem de ser MEU: `realProbeCount()` só conta sondagens de `realProbes`, e este teste
    // não toca o host. Contar as chamadas do probe injetado é o que mede o memo de fato.
    let sondagens = 0;
    const contando = probesFalsos({
      which: () => {
        sondagens++;
        return "/usr/bin/bwrap";
      },
    });
    await Promise.all(Array.from({ length: 20 }, async () => detectBwrapMemoizado(contando)));
    expect(
      sondagens,
      "20 chamadas concorrentes sondaram mais de uma vez — o memo não serializou",
    ).toBe(1);
  });
});
