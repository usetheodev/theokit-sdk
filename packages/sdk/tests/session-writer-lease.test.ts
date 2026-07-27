/**
 * M81 T1.2 — lease de escritor único para uma sessão.
 *
 * ## O problema medido
 *
 * Nada impede hoje que dois processos anexem ao mesmo transcript JSONL. O caso concreto que o M81
 * cita: `exec resume --last` pode escrever na sessão viva do TUI. Duas escritas intercaladas num
 * append-only produzem um arquivo cujas linhas são válidas individualmente e cuja SEQUÊNCIA é
 * ficção — e nada acusa, porque cada linha isolada faz parse.
 *
 * ## O ADR D2 do plano dizia "compõe `withFileLock`", e a implementação divergiu — com razão escrita
 *
 * O instinto do D2 estava certo: não construir um segundo mecanismo de lock. O que não coube foi a
 * FORMA. `withFileLock(path, fn)` é baseado em escopo — segura o lock pela duração de um callback.
 * Um lease de sessão é segurado **entre turnos**, enquanto o processo for dono da sessão, com
 * `release()` explícito. Embrulhar o ciclo de vida inteiro da sessão num callback inverteria o
 * controle do agent loop.
 *
 * A implementação usa a MESMA primitiva que o `withFileLock` usa por baixo — lockfile de criação
 * exclusiva (`wx`) — com semântica de lease em cima. O mecanismo segue único; só a vida dele mudou.
 * A divergência está registrada no source, não escondida.
 *
 * ## Falha RÁPIDA, não espera
 *
 * Um segundo escritor que esperasse pelo lease travaria o `exec` atrás de uma sessão de TUI que pode
 * durar horas. `rules/error-handling.md § 2` pede erro tipado; aqui ele também precisa ser imediato,
 * para o chamador poder decidir entre forkar e desistir.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  acquireSessionWriter,
  SessionBusyError,
} from "../src/internal/persistence/session-writer.js";

const dir = mkdtempSync(join(tmpdir(), "m81-lease-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const sessao = (nome: string): string => join(dir, `${nome}.jsonl`);

describe("M81 T1.2 — lease de escritor de sessão", () => {
  it("test_o_primeiro_escritor_obtem_o_lease", async () => {
    const lease = await acquireSessionWriter(sessao("a"));
    expect(lease).toBeDefined();
    await lease.release();
  });

  it("test_o_segundo_FALHA_RAPIDO_com_erro_tipado", async () => {
    // Esperar travaria o `exec` atrás de uma sessão de TUI que pode durar horas. O erro tipado deixa
    // o chamador escolher: forkar para um id novo, ou desistir com diagnóstico.
    const primeiro = await acquireSessionWriter(sessao("b"));
    const inicio = Date.now();

    await expect(acquireSessionWriter(sessao("b"))).rejects.toBeInstanceOf(SessionBusyError);
    expect(Date.now() - inicio, "tem de falhar rápido, não esperar o lease").toBeLessThan(2000);

    await primeiro.release();
  });

  it("test_liberar_o_lease_permite_o_proximo", async () => {
    const primeiro = await acquireSessionWriter(sessao("c"));
    await primeiro.release();

    // Sem isto, o lease seria uma trava permanente em vez de um lease.
    const segundo = await acquireSessionWriter(sessao("c"));
    expect(segundo).toBeDefined();
    await segundo.release();
  });

  it("test_CONTRAPROVA_sessoes_distintas_nao_disputam", async () => {
    // Sem esta, um lease global passaria nos testes acima e serializaria TODAS as sessões — o
    // oposto do objetivo, e invisível até alguém rodar dois agentes ao mesmo tempo.
    const a = await acquireSessionWriter(sessao("d1"));
    const b = await acquireSessionWriter(sessao("d2"));

    expect(a).toBeDefined();
    expect(b).toBeDefined();
    await a.release();
    await b.release();
  });

  it("test_duas_aquisicoes_concorrentes_so_uma_vence", async () => {
    // Concurrent test com atomic-counter invariant: `Promise.allSettled` de duas aquisições ⇒
    // exatamente 1 `fulfilled` e 1 `rejected`. Um lease que deixasse as duas passarem seria
    // decorativo — e é precisamente o estado de hoje, sem lease nenhum.
    const p = sessao("e");
    const r = await Promise.allSettled([acquireSessionWriter(p), acquireSessionWriter(p)]);

    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(r.filter((x) => x.status === "rejected")).toHaveLength(1);

    for (const x of r) {
      if (x.status === "fulfilled") await x.value.release();
    }
  });

  it("test_o_erro_nomeia_a_sessao_disputada", async () => {
    // `error-handling.md § 2`: contexto suficiente para agir. Saber QUAL sessão está ocupada é o que
    // permite ao chamador decidir entre forkar e esperar o usuário fechar o TUI.
    const p = sessao("f");
    const primeiro = await acquireSessionWriter(p);
    const err = (await acquireSessionWriter(p).catch((e: unknown) => e)) as SessionBusyError;

    expect(err.sessionPath).toBe(p);
    expect(err.message).toContain(p);
    await primeiro.release();
  });
});
