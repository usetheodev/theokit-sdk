/**
 * M76 T3.1 — o asker vem do CONTEXTO da run, não de um valor fixado na construção.
 *
 * ## O desenho estava escrito por quem construiu o SDK
 *
 * A doc de `CustomTool.handler` descreve este caso de uso em duas frases:
 *
 * > *"M7 — the same `ctx` also carries an optional user `context` (provided once via
 * > `SendOptions.context`), so shared config like a `projectRoot` **is read by every tool instead of
 * > baked into each factory**."*
 * >
 * > *"#119 — `ctx.threadId` is the run's session identity (…), so **a stateful tool shared across
 * > sessions can scope its state per session instead of leaking it**."*
 *
 * "baked into each factory" é literalmente o `askUser` de hoje; "leaking it across sessions" é
 * literalmente o singleton de módulo do consumidor. As duas frases nomeiam os dois defeitos do M76.
 *
 * ## O que NÃO resolve, e por que está escrito aqui
 *
 * `ContextualTool.__requiredContext` é `"Phantom — never present at runtime"`. O nome sugere que
 * carrega contexto; ele carrega apenas TIPO. Apontar para ele teria produzido uma recomendação que
 * não implementa — foi o risco que o `/discover-edge-cases` nomeou (EC-1) antes de a implementação
 * começar.
 *
 * ## O caso negativo é obrigatório
 *
 * Sem asker nenhum, a tool **não pode** devolver uma promise que nunca resolve: o turno pararia até o
 * timeout de 5 minutos. `error-handling.md` § 2 exige erro tipado, e ele precisa ser IMEDIATO.
 */
import { describe, expect, it } from "vitest";

import { createQuestionTool } from "../src/question.js";

describe("M76 T3.1 — o asker vem do contexto", () => {
  it("test_asker_do_contexto_vence_o_da_fabrica", async () => {
    let daFabrica = 0;
    let doContexto = 0;
    const t = createQuestionTool({
      askUser: async () => {
        daFabrica++;
        return "fabrica";
      },
    });

    const out = await t.handler(
      { question: "qual?" },
      {
        context: {
          askUser: async () => {
            doContexto++;
            return "contexto";
          },
        },
      },
    );

    // Contagem de CAUSA, não inspeção do texto: prova qual função rodou.
    expect(doContexto, "o asker do contexto tem de ser o chamado").toBe(1);
    expect(daFabrica, "o da fábrica NÃO pode ser chamado quando há um no contexto").toBe(0);
    expect(out).toContain("contexto");
  });

  it("test_sem_contexto_usa_o_da_fabrica", async () => {
    // Retrocompatibilidade: quem já construía com `askUser` não muda.
    let daFabrica = 0;
    const t = createQuestionTool({
      askUser: async () => {
        daFabrica++;
        return "fabrica";
      },
    });
    const out = await t.handler({ question: "qual?" });
    expect(daFabrica).toBe(1);
    expect(out).toContain("fabrica");
  });

  it("test_NEGATIVO_sem_asker_nenhum_erro_tipado_imediato", async () => {
    // Sem asker, o antigo desenho devolveria uma promise pendente e o turno pararia 5 minutos.
    const t = createQuestionTool({});
    const inicio = Date.now();
    const out = (await t.handler({ question: "qual?" })) as string;
    const decorrido = Date.now() - inicio;

    const parsed = JSON.parse(out) as { ok: boolean; error?: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.error, "o erro precisa ser TIPADO, não uma frase livre").toBe("no_asker");
    // A imediatez não é detalhe: é a razão de o `"busy"` do consumidor existir.
    expect(decorrido, "tem de resolver de imediato, não esperar o timeout").toBeLessThan(100);
  });

  it("test_contexto_sem_askUser_cai_no_da_fabrica", async () => {
    // CONTRAPROVA: um `context` presente mas sem `askUser` não pode ser confundido com "há asker".
    // Sem esta, uma implementação que só checasse `ctx.context != null` passaria nos testes acima.
    let daFabrica = 0;
    const t = createQuestionTool({
      askUser: async () => {
        daFabrica++;
        return "fabrica";
      },
    });
    await t.handler({ question: "q" }, { context: { projectRoot: "/tmp" } });
    expect(daFabrica).toBe(1);
  });

  it("test_askers_de_threadIds_distintos_nao_se_misturam", async () => {
    // Concurrent test com atomic-counter invariant: duas sessões perguntam ao MESMO tempo e cada
    // uma recebe a resposta do SEU thread. É o invariante que permite matar o singleton de módulo —
    // com estado global, uma das duas veria a pergunta da outra.
    const t = createQuestionTool({});
    const chamadas: string[] = [];
    const asker = (tag: string) => async (): Promise<string> => {
      await new Promise((r) => setTimeout(r, 5));
      chamadas.push(tag);
      return tag;
    };

    const [a, b] = await Promise.all([
      t.handler({ question: "q" }, { threadId: "s1", context: { askUser: asker("s1") } }),
      t.handler({ question: "q" }, { threadId: "s2", context: { askUser: asker("s2") } }),
    ]);

    expect(chamadas.sort()).toEqual(["s1", "s2"]);
    expect(a).toContain("s1");
    expect(b).toContain("s2");
  });
});

/**
 * M76 review (HIGH-1 e MEDIUM-1) — a FIAÇÃO, não a capacidade.
 *
 * O review adversarial encontrou o defeito central do milestone: `AskBridge` suportava escopo por
 * sessão e o handler recebia `ctx.threadId`, mas **o valor nunca era encaminhado**. O `Map` tinha uma
 * chave para sempre — o `let pending` com outro nome. Os testes anteriores construíam o bridge à mão
 * e passavam `'s1'`/`'s2'`: provavam que a CLASSE suporta, não que o SISTEMA usa.
 *
 * Estes dois testam a ligação. Sem eles, desligá-la de novo não quebraria nada.
 */
describe("M76 review — a fiação de threadId e a liberação do slot", () => {
  it("test_o_threadId_do_ctx_CHEGA_ao_asker", async () => {
    const recebidos: (string | undefined)[] = [];
    const t = createQuestionTool({
      askUser: async (_q, threadId) => {
        recebidos.push(threadId);
        return "ok";
      },
    });

    await t.handler({ question: "q" }, { threadId: "sessao-42" });

    expect(
      recebidos[0],
      "o threadId não chegou ao asker — o Map do bridge cairia sempre no slot padrão",
    ).toBe("sessao-42");
  });

  it("test_o_timeout_AVISA_que_a_pergunta_foi_abandonada", async () => {
    // Sem este aviso o slot fica ocupado para sempre: a UI segue mostrando um prompt órfão e toda
    // pergunta seguinte recebe "já há uma pendente" — erro permanente por algo que ninguém espera.
    const abandonados: (string | undefined)[] = [];
    const t = createQuestionTool({
      askUser: () => new Promise<string>(() => undefined), // nunca resolve
      timeoutMs: 20,
      onAbandon: (threadId) => abandonados.push(threadId),
    });

    const out = (await t.handler({ question: "q" }, { threadId: "s9" })) as string;

    expect(JSON.parse(out).error).toBe("timeout");
    expect(abandonados, "o timeout tem de liberar o slot da sessão").toEqual(["s9"]);
  });
});
