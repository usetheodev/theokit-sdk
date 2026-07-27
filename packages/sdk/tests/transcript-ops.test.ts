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
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
