/**
 * M77 T4.1 — `toolResultBudget`: head+tail e um marcador legível por máquina.
 *
 * ## Por que ESTENDER e não criar
 *
 * A descoberta mediu seis tetos de saída no `sdk-tools`, com **cinco valores diferentes** e nenhuma
 * coordenação: `web-fetch.ts:26` (1 MB), `shell-exec.ts:22` (5 MB), `git-diff.ts:27` (5 MB),
 * `run-vitest.ts:36` (10 MB), `git-status.ts:35` (configurável) e este helper (30 000 B).
 *
 * E o achado que decidiu o desenho: `truncateOutput` é exportado no barril (`index.ts:109`) e tem
 * **zero consumidores de produção** — o único uso fora do próprio arquivo é o teste dele. O SDK já
 * pagou por um truncador compartilhado, ninguém o usa, e cada tool reimplementou o seu. Criar um
 * SÉTIMO seria o defeito, não a correção (parsimony-ladder rung 4).
 *
 * ## O que faltava para ele servir de caminho único
 *
 *  - **head+tail**: o corte era só head (`truncation.ts:48`). Para saída de comando, o FIM costuma
 *    carregar o que importa — o erro, o resumo, o prompt. Cortar só a cauda descarta a conclusão.
 *  - **marcador legível por máquina**: o sinal era uma frase em inglês injetada no meio do texto
 *    (`"[Output truncated. Full output: …]"`). Um consumidor que quisesse saber quanto foi perdido
 *    teria de fazer parsing de prosa. `originalBytes` resolve isso.
 *
 * ## O que este teste NÃO faz
 *
 * Não uniformiza os seis valores. Consolidar o MECANISMO e uniformizar os LIMITES são duas coisas:
 * 1 MB para `web-fetch` e 10 MB para `run-vitest` podem ser diferentes por boa razão. O plano (D2)
 * declara isso explicitamente como fora de escopo desta entrega.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { truncateOutput } from "../src/truncation.js";

const outputDir = mkdtempSync(join(tmpdir(), "m77-trunc-"));
afterAll(() => rmSync(outputDir, { recursive: true, force: true }));

/** 60 linhas numeradas — as pontas são identificáveis, o meio é descartável. */
const longo = Array.from({ length: 60 }, (_, i) => `linha-${String(i).padStart(2, "0")}`).join(
  "\n",
);

describe("M77 T4.1 — truncamento head+tail", () => {
  it("test_head_tail_preserva_INICIO_e_FIM", () => {
    // O ponto inteiro do modo: com head-only, `linha-59` — onde vive o erro de um comando — some.
    const r = truncateOutput(longo, { maxBytes: 200, mode: "head-tail", outputDir });

    expect(r.truncated).toBe(true);
    expect(r.content, "o início tem de sobreviver").toContain("linha-00");
    expect(r.content, "e o FIM também — é onde mora o erro").toContain("linha-59");
    expect(r.content, "o meio é o que se descarta").not.toContain("linha-30");
  });

  it("test_originalBytes_reporta_o_tamanho_REAL_e_nao_o_truncado", () => {
    // O marcador legível por máquina. Sem ele, saber quanto se perdeu exige parsing da prosa
    // injetada no meio do texto.
    const r = truncateOutput(longo, { maxBytes: 200, mode: "head-tail", outputDir });

    expect(r.originalBytes).toBe(Buffer.byteLength(longo, "utf-8"));
    expect(
      r.originalBytes,
      "tem de ser MAIOR que o teto, senão não houve truncamento",
    ).toBeGreaterThan(200);
  });

  it("test_modo_head_continua_o_DEFAULT", () => {
    // Retrocompatibilidade: o helper é exportado no barril público. Mudar o default silenciosamente
    // mudaria a saída de qualquer consumidor futuro que já tivesse adotado o modo antigo.
    const semModo = truncateOutput(longo, { maxBytes: 200, outputDir });
    const comHead = truncateOutput(longo, { maxBytes: 200, mode: "head", outputDir });

    // Comparar o TRECHO, não a string inteira: o trailer carrega o `overflowPath`, que agora é
    // deliberadamente único por chamada (a correção da colisão logo abaixo). A primeira versão
    // deste teste fazia `toBe` no conteúdo completo e passou a falhar por causa do próprio fix —
    // o oráculo estava medindo o nome do arquivo, não o modo de corte.
    const trecho = (s: string): string => s.split("\n\n[Output truncated")[0] ?? "";
    expect(trecho(semModo.content)).toBe(trecho(comHead.content));
    expect(semModo.content, "o default corta a cauda, como sempre fez").not.toContain("linha-59");
  });

  it("test_CONTRAPROVA_saida_curta_nao_e_truncada_em_nenhum_modo", () => {
    // Sem esta, uma implementação que truncasse SEMPRE passaria nos testes acima. E `originalBytes`
    // precisa estar presente mesmo no caminho feliz — um campo que só aparece na falha obriga o
    // consumidor a testar `undefined`, que é a porta do valor mágico.
    const curto = "abc";
    for (const mode of ["head", "head-tail"] as const) {
      const r = truncateOutput(curto, { maxBytes: 100, mode, outputDir });
      expect(r.truncated).toBe(false);
      expect(r.content).toBe(curto);
      expect(r.originalBytes).toBe(3);
    }
  });

  it("test_exatamente_no_limite_NAO_trunca", () => {
    // O `<=` de `truncation.ts:37` (EC-3 do desenho original). Preservado — um `<` faria toda saída
    // de tamanho exato virar arquivo de overflow.
    const r = truncateOutput("abc", { maxBytes: 3, mode: "head-tail", outputDir });
    expect(r.truncated).toBe(false);
  });

  it("test_duas_truncagens_no_MESMO_ms_nao_colidem_no_arquivo_de_overflow", () => {
    // Bug real encontrado pelo próprio M77, não um cenário inventado: o nome era
    // `overflow-${Date.now()}.txt`, então duas truncagens dentro do mesmo milissegundo resolviam
    // para o MESMO caminho e a segunda sobrescrevia a primeira em silêncio. O `overflowPath`
    // devolvido ao chamador passava a apontar para a saída de outro — resposta errada, não erro.
    //
    // Apareceu como falha intermitente ao rodar duas suítes de truncamento juntas; a causa estava no
    // código de produção, não no teste. `rules/testing.md § 3`: flake é bug.
    const a = truncateOutput(`${longo}-A`, { maxBytes: 100, outputDir });
    const b = truncateOutput(`${longo}-B`, { maxBytes: 100, outputDir });

    expect(a.overflowPath).not.toBe(b.overflowPath);
  });

  it("test_head_tail_com_teto_minusculo_nao_produz_utf8_corrompido", () => {
    // Edge: o corte é por BYTE, e um teto ímpar no meio de um caractere multibyte partiria o code
    // point. `Buffer.toString` substituiria por U+FFFD, e o modelo leria lixo.
    const acentuado = "áéíóú".repeat(40);
    const r = truncateOutput(acentuado, { maxBytes: 9, mode: "head-tail", outputDir });

    expect(r.truncated).toBe(true);
    expect(
      r.content,
      "nenhum caractere de substituição — o corte respeita o limite do code point",
    ).not.toContain("�");
  });
});
