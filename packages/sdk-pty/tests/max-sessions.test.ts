/**
 * M77 T5.1 — `maxSessions`: um teto para o modelo parar de abrir shells indefinidamente.
 *
 * ## O problema
 *
 * `startInteractive` cria uma sessão e a guarda no `Map` (`pty-interactive-backend.ts:91`) sem
 * qualquer limite. Cada uma é um processo real com TTL de horas. Um modelo que não percebe que já
 * tem um shell aberto abre outro — e outro. O TTL eventualmente recolhe, mas "eventualmente" é tarde
 * demais quando o limite é o número de PIDs da máquina.
 *
 * ## O erro precisa DIZER O QUE FAZER
 *
 * Um erro que só diz "limite atingido" ensina o modelo a tentar de novo. `rules/error-handling.md
 * § 2` exige mensagem com contexto; aqui o contexto útil é a **lista das sessões vivas**, porque a
 * ação correta é reusar uma delas, não esperar. É a diferença entre um erro que interrompe e um erro
 * que orienta.
 *
 * ## Por que PTY REAL, e não um duplo de `spawnPty`
 *
 * A primeira versão deste arquivo subclassificava o backend para trocar `spawnPty` por um duplo. Duas
 * razões para ter desistido, e a segunda é a que importa:
 *
 *  1. `spawnPty` é `private` — o duplo exigiria afrouxar a visibilidade só para o teste;
 *  2. **a lição do M75**: um helper que substitui `spawnPty` inteiro faz tudo que vive DENTRO dele
 *     nunca rodar. O teto precisa provar que a vaga é contada contra sessões que existem de verdade,
 *     com `onExit` real liberando a vaga — um duplo provaria apenas que meu duplo conta.
 *
 * Este arquivo segue a convenção que `pty-interactive-backend.test.ts` já estabeleceu: PTY real, e
 * `describe.skip` quando o build nativo do node-pty não está disponível.
 */
import { afterEach, describe, expect, it } from "vitest";

import { MaxSessionsError, PtyInteractiveBackend } from "../src/pty-interactive-backend.js";

const probe = new PtyInteractiveBackend();
const d = probe.available() ? describe : describe.skip;

let backend: PtyInteractiveBackend;
afterEach(() => {
  backend?.killAll();
});

const abrir = (b: PtyInteractiveBackend): Promise<{ sessionId: string }> =>
  b.startInteractive("cat", { yieldMs: 60 });

d("M77 T5.1 — teto de sessões interativas (PTY real)", () => {
  it("test_abrir_alem_do_teto_lanca_erro_TIPADO", async () => {
    backend = new PtyInteractiveBackend({ maxSessions: 2 });
    await abrir(backend);
    await abrir(backend);

    // Erro de domínio, não `Error` genérico — quem trata precisa distinguir "teto" de "spawn falhou".
    await expect(abrir(backend)).rejects.toBeInstanceOf(MaxSessionsError);
  });

  it("test_o_erro_LISTA_as_sessoes_vivas_para_o_modelo_reusar", async () => {
    backend = new PtyInteractiveBackend({ maxSessions: 2 });
    const a = await abrir(backend);
    const c = await abrir(backend);

    const err = (await abrir(backend).catch((e: unknown) => e)) as MaxSessionsError;

    // A parte que transforma o erro de interrupção em orientação.
    expect(err.liveSessionIds).toHaveLength(2);
    expect(err.liveSessionIds).toContain(a.sessionId);
    expect(err.liveSessionIds).toContain(c.sessionId);
    // E a mensagem, que é o que o modelo de fato lê, precisa carregar os ids.
    expect(err.message).toContain(a.sessionId);
  });

  it("test_matar_uma_sessao_LIBERA_a_vaga", async () => {
    backend = new PtyInteractiveBackend({ maxSessions: 1 });
    const a = await abrir(backend);
    await expect(abrir(backend)).rejects.toBeInstanceOf(MaxSessionsError);

    backend.kill(a.sessionId);

    // Se o teto contasse sessões já abertas em vez das VIVAS, esta abertura ainda falharia.
    await expect(abrir(backend)).resolves.toBeDefined();
  });

  it("test_CONTRAPROVA_sem_maxSessions_nao_ha_teto", async () => {
    // Sem esta, uma implementação com teto embutido (digamos 3) passaria em tudo acima e quebraria
    // todo consumidor existente em silêncio. O default TEM de ser ilimitado.
    backend = new PtyInteractiveBackend();
    for (let i = 0; i < 4; i++) await abrir(backend);
    expect(backend.activeSessionCount()).toBe(4);
  });

  it("test_duas_aberturas_concorrentes_no_limite_so_uma_passa", async () => {
    // Concurrent test com atomic-counter invariant: com teto 1, duas aberturas simultâneas disputam
    // a última vaga. O guard precisa ler a contagem e reservar a vaga ANTES do primeiro `await`; se
    // checasse e só inserisse no `Map` depois do spawn (que é assíncrono), as duas veriam `0`, as
    // duas passariam, e o teto viraria decorativo.
    backend = new PtyInteractiveBackend({ maxSessions: 1 });
    const r = await Promise.allSettled([abrir(backend), abrir(backend)]);

    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(r.filter((x) => x.status === "rejected")).toHaveLength(1);
    expect(backend.activeSessionCount(), "nenhuma sessão pode ter vazado além do teto").toBe(1);
  });
});
