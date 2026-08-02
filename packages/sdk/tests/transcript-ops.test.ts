/**
 * M81 T1.1 — as operações de transcript que o consumidor fazia à mão dentro do store.
 *
 * ## O que existe hoje, medido
 *
 * `agents/lib/session/backtrack.ts:188` (agent-builder) escreve assim:
 *
 * ```ts
 * writeFileSync(dst, body.length > 0 ? body + '\n' : '')
 * ```
 *
 * Escrita **crua** no store de transcripts do framework: sem atomicidade, sem lock, sem passar por
 * API nenhuma. São 243 LoC reimplementando parse, corte e escrita de um formato que é do framework.
 *
 * ## A regra que viaja junto (ADR D3 do plano)
 *
 * `rules/audit-trail-rotation.md § Session transcripts (M60)` estabelece uma lista NEVER-delete:
 * o ponteiro vivo, o transcript mais recente, e qualquer entrada de registro ativa. Essa regra vive
 * hoje no CONSUMIDOR. Mover a operação para o framework sem mover a regra criaria uma API capaz de
 * apagar exatamente o que a regra protege — o mesmo desenho que produziu `reconcileUpdateGoalStatus`
 * no M80: conhecimento crítico fora do lugar, aplicado por convenção.
 *
 * ## Por que a preservação da ORIGEM é a asserção mais importante
 *
 * Um fork que corta o destino certo mas corrompe a origem destrói a sessão do usuário. É a operação
 * mais perigosa deste milestone, e a que um teste de "o destino está certo" não pegaria.
 */
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";
import { loadJsonl } from "../src/internal/persistence/jsonl.js";
import {
  forkTranscript,
  LiveSessionError,
  readJsonlTail,
} from "../src/internal/persistence/transcript-ops.js";

const dir = mkdtempSync(join(tmpdir(), "m81-transcript-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Escreve um transcript de N registros e devolve o caminho. */
function escreverTranscript(nome: string, n: number): string {
  const p = join(dir, nome);
  writeFileSync(p, `${Array.from({ length: n }, (_, i) => JSON.stringify({ i })).join("\n")}\n`);
  return p;
}

describe("M81 T1.1 — operações de transcript", () => {
  it("test_forkTranscript_PRESERVA_a_origem_intacta", () => {
    const src = escreverTranscript("origem.jsonl", 10);
    const antes = readFileSync(src, "utf8");

    forkTranscript(src, join(dir, "fork-a.jsonl"), { beforeRecordIndex: 4 });

    // A asserção que mais importa: um fork que corta certo mas corrompe a origem destrói a sessão
    // do usuário, e um teste focado só no destino não pegaria isso.
    expect(readFileSync(src, "utf8"), "a origem tem de sobreviver byte a byte").toBe(antes);
  });

  it("test_forkTranscript_corta_no_beforeRecordIndex", () => {
    const src = escreverTranscript("origem2.jsonl", 10);
    const dst = join(dir, "fork-b.jsonl");

    forkTranscript(src, dst, { beforeRecordIndex: 4 });

    expect(loadJsonl(dst)).toHaveLength(4);
  });

  it("test_forkTranscript_RECUSA_sobrescrever_um_destino_existente", () => {
    // Sobrescrever em silêncio é perda de dado sem erro — o pior modo de falha para uma operação
    // que mexe em sessão de usuário.
    const src = escreverTranscript("origem3.jsonl", 5);
    const dst = escreverTranscript("ja-existe.jsonl", 3);

    expect(() => forkTranscript(src, dst, { beforeRecordIndex: 2 })).toThrow();
    expect(loadJsonl(dst), "o destino existente não pode ter sido tocado").toHaveLength(3);
  });

  it("test_forkTranscript_RECUSA_escrever_sobre_o_ponteiro_vivo", () => {
    // A lista NEVER-delete do M60, agora dentro do framework (ADR D3). Erro TIPADO, não genérico:
    // quem chama precisa distinguir "sessão protegida" de "disco cheio".
    const src = escreverTranscript("origem4.jsonl", 5);
    const vivo = escreverTranscript("sessao-viva.jsonl", 5);

    expect(() =>
      forkTranscript(src, vivo, { beforeRecordIndex: 2, liveSessionPaths: [vivo] }),
    ).toThrow(LiveSessionError);
  });

  it("test_readJsonlTail_devolve_os_ULTIMOS_registros", () => {
    const src = escreverTranscript("tail.jsonl", 100);
    const tail = readJsonlTail<{ i: number }>(src, { maxRecords: 3 });

    expect(tail).toHaveLength(3);
    expect(
      tail.map((r) => r.i),
      "tem de ser o FIM, não o começo",
    ).toEqual([97, 98, 99]);
  });

  it("test_readJsonlTail_le_de_TRAS_para_frente", () => {
    // O ponto da operação: um transcript longo não deve ser carregado inteiro para ler as últimas
    // linhas. Sem isto, `readJsonlTail` seria só um `slice` com nome melhor.
    // 40 000 registros ≈ 500 KB — várias vezes o chunk de 64 KB. Com um fixture menor que um chunk,
    // a primeira leitura pegaria o arquivo inteiro e o teste passaria por acidente do tamanho, não
    // por a implementação estar certa.
    const src = escreverTranscript("grande.jsonl", 40_000);
    const bytesTotais = readFileSync(src).length;
    const { bytesRead } = readJsonlTail<{ i: number }>(src, {
      maxRecords: 2,
      _stats: true,
    }) as never;

    expect(
      bytesRead,
      "leu o arquivo inteiro — a leitura de trás para frente não está acontecendo",
    ).toBeLessThan(bytesTotais / 2);
  });

  it("test_loadJsonl_tolera_linha_parcial_final", () => {
    // Artefato de crash: o processo morreu no meio de uma escrita. Os registros completos anteriores
    // continuam válidos e devem ser recuperáveis.
    const p = join(dir, "crash.jsonl");
    writeFileSync(p, `${JSON.stringify({ i: 1 })}\n${JSON.stringify({ i: 2 })}\n{"i":3`);

    const rec = loadJsonl(p, { tolerateTrailingPartialLine: true });
    expect(rec).toHaveLength(2);
  });

  it("test_CONTRAPROVA_loadJsonl_SEM_a_opcao_ainda_falha", () => {
    // A tolerância é opt-in. Se fosse default, um arquivo corrompido no MEIO passaria despercebido —
    // e aí a perda de dado seria silenciosa em vez de ruidosa.
    const p = join(dir, "crash2.jsonl");
    writeFileSync(p, `${JSON.stringify({ i: 1 })}\n{"i":2`);

    expect(() => loadJsonl(p)).toThrow();
  });

  it("test_dois_forks_concorrentes_nao_corrompem_o_destino", async () => {
    // Concurrent test com atomic-counter invariant: dois forks para o MESMO destino ⇒ exatamente um
    // vence, o outro falha tipado. Sem escrita atômica, os dois escreveriam por cima um do outro e o
    // vencedor seria o último a fechar o descritor — com o arquivo possivelmente meio escrito.
    const src = escreverTranscript("origem5.jsonl", 20);
    const dst = join(dir, "disputado.jsonl");

    const r = await Promise.allSettled([
      Promise.resolve().then(() => forkTranscript(src, dst, { beforeRecordIndex: 5 })),
      Promise.resolve().then(() => forkTranscript(src, dst, { beforeRecordIndex: 9 })),
    ]);

    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(r.filter((x) => x.status === "rejected")).toHaveLength(1);
    // E o destino tem de estar ÍNTEGRO — o número de registros de um dos dois, não uma mistura.
    expect([5, 9]).toContain(loadJsonl(dst).length);
  });
});

/**
 * M107 T1.2 — o destino do fork nasce PRIVADO.
 *
 * ## O defeito, medido antes da mudança
 *
 * `transcript-ops.ts:84` fazia `openSync(dst, "wx")` **sem argumento de modo**, então o arquivo
 * nascia `0o666 & ~umask`. Medido nesta máquina, reproduzindo aquela linha:
 *
 * ```
 * umask 0o002  ->  destino=0o664      <-- group-WRITABLE
 * umask 0o022  ->  destino=0o644      <-- world-readable
 * umask 0o200  ->  destino=0o466      <-- group E world readable
 * ```
 *
 * Um transcript carrega o conteúdo da conversa. O `0o664` é estritamente pior do que o `0o644` que o
 * roadmap afirmava — a alegação nunca tinha sido medida. E **nenhum teste, em lugar nenhum, travava o
 * modo do arquivo criado**: é por isso que o defeito era invisível ao upstream, apesar de cinco
 * comportamentos deste mesmo fork já terem trava.
 *
 * ## Por que um DEFAULT e não um knob (D6)
 *
 * Um knob obrigatório chegaria por **omissão** a zero consumidores — a forma de falha que
 * `.claude/rules/mecanismo-anti-esquecimento.md § 3` nomeia como a decisiva. O `mode?` existe para
 * quem precisar de outro valor; a correção não depende de ninguém lembrar dele.
 *
 * ## Por que NÃO há reafirmação de modo aqui, ao contrário de `atomicWriteJson`
 *
 * Sob `umask 0o200` o destino sai `0o400` em vez de `0o600` — o `umask` limpou o bit de escrita do
 * dono. Isso é aceito de propósito: o invariante que este item compra é *"nem grupo nem outros"*, e
 * `0o400` o satisfaz **com folga**. Reafirmar com `fchmod` devolveria um bit que o operador pediu
 * para tirar, ou seja, o SDK afrouxaria o `umask` — direção errada numa correção de segurança. Em
 * `atomicWriteJson` a reafirmação existe porque lá o modo é um pedido EXPLÍCITO do chamador; aqui ele
 * é um default do SDK.
 *
 * ## O que este bloco deliberadamente NÃO testa
 *
 * `EEXIST` no destino existente e a recusa tipada da sessão viva **já têm dono** —
 * `test_forkTranscript_RECUSA_sobrescrever_um_destino_existente` e
 * `test_forkTranscript_RECUSA_escrever_sobre_o_ponteiro_vivo`, acima neste arquivo, e ambos rodam no
 * mesmo comando. Repeti-los aqui seria um segundo oráculo sobre o mesmo fato, que é o que
 * `.claude/rules/mecanismo-anti-esquecimento.md § 5.6` proíbe: dois oráculos divergem.
 *
 * ## Contraprova por mutação (executada; saída no log da iteração)
 *
 * | Mutação em `transcript-ops.ts` | Testes que morrem |
 * |---|---|
 * | `openSync(dst, "wx", options.mode ?? 0o600)` → `openSync(dst, "wx")` | os três deste bloco |
 */
describe("M107 T1.2 — o destino do fork nasce privado", () => {
  const dirModo = mkdtempSync(join(tmpdir(), "m107-fork-modo-"));
  afterAll(() => rmSync(dirModo, { recursive: true, force: true }));

  /** Bits de permissão, sem o tipo de nó. */
  const modo = (p: string): number => statSync(p).mode & 0o777;

  /** Roda `fn` sob um `umask` e restaura o anterior — o `umask` é estado de PROCESSO. */
  function sobUmask<T>(mask: number, fn: () => T): T {
    const anterior = process.umask(mask);
    try {
      return fn();
    } finally {
      process.umask(anterior);
    }
  }

  function origem(nome: string): string {
    const p = join(dirModo, nome);
    writeFileSync(p, '{"i":0}\n{"i":1}\n');
    return p;
  }

  it("test_o_destino_do_fork_nasce_0600", () => {
    // Arrange — `umask 0o002` é o desta máquina, e é o que produzia `0o664` (group-writable).
    const src = origem("o1.jsonl");
    const dst = join(dirModo, "nasce-0600.jsonl");

    // Act
    sobUmask(0o002, () => forkTranscript(src, dst));

    // Assert
    expect(modo(dst)).toBe(0o600);
  });

  it("test_nenhum_umask_deixa_grupo_ou_outros_enxergarem_o_transcript", () => {
    // Arrange — o invariante REAL do item, sobre os três umasks medidos. Sob `0o200` o resultado é
    // `0o400`: mais restritivo que o pedido, nunca menos (ver o docblock).
    const src = origem("o2.jsonl");

    for (const mask of [0o002, 0o022, 0o200]) {
      const dst = join(dirModo, `mask-${mask.toString(8)}.jsonl`);

      // Act
      sobUmask(mask, () => forkTranscript(src, dst));

      // Assert — zero bits para grupo e para outros, sob qualquer umask.
      expect(modo(dst) & 0o077, `umask 0o${mask.toString(8)} vazou permissão`).toBe(0);
      expect(modo(dst) & 0o400).toBe(0o400);
    }
  });

  it("test_mode_explicito_e_honrado", () => {
    // Arrange — a primitiva troca o DEFAULT, não a liberdade do chamador: um modo mais permissivo
    // que `0o600` é honrado, porque impor política aqui seria a primitiva decidir pelo consumidor.
    const src = origem("o3.jsonl");
    const dst = join(dirModo, "explicito.jsonl");

    // Act
    sobUmask(0o002, () => forkTranscript(src, dst, { mode: 0o640 }));

    // Assert
    expect(modo(dst)).toBe(0o640);
  });

  it("test_dois_forks_concorrentes_para_o_mesmo_destino_so_um_vence_e_o_vencedor_e_privado", async () => {
    // Arrange — a exclusividade (`wx`) e o modo têm de valer JUNTOS: sem esta asserção provaríamos a
    // exclusividade e não a privacidade.
    const src = origem("o4.jsonl");
    const dst = join(dirModo, "disputado-modo.jsonl");

    // Act
    const r = await sobUmask(0o002, async () =>
      Promise.allSettled([
        Promise.resolve().then(() => forkTranscript(src, dst)),
        Promise.resolve().then(() => forkTranscript(src, dst)),
      ]),
    );

    // Assert (happens-before observation, depois da barreira)
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(r.filter((x) => x.status === "rejected")).toHaveLength(1);
    expect(modo(dst)).toBe(0o600);
  });
});
