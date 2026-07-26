/**
 * M80 T1.1 — o judge deixa de ser provider-cego, e falha rápido quando a credencial não serve.
 *
 * ## O custo medido, documentado pelo próprio consumidor
 *
 * `judge-call.ts` lê **só** `OPENROUTER_API_KEY` (*"EC-A: single env source — OpenRouter only"*) e
 * fixa `openai/gpt-4o-mini`. O agent-builder já escreveu o preço disso, em `agents/lib/goal/goal.ts`:
 *
 * > *"The SDK's default judge (`openai/gpt-4o-mini`) only resolves on OpenRouter; with an Anthropic
 * > key it 404s and with an OAuth bearer it 401s — every goal then burns 3 full turns before
 * > 'failed' with a misleading reason."*
 *
 * Ele contornou derivando o modelo por conta própria. O conhecimento está no lugar errado: quem sabe
 * qual judge resolve para qual credencial é o subsistema de judge, não cada consumidor.
 *
 * ## Por que 401/404 falham rápido e parse malformado NÃO
 *
 * São erros de natureza diferente (`rules/error-handling.md § 2`). Um modelo inexistente não melhora
 * em retry — queimar 3 turnos antes de desistir é desperdício com diagnóstico pior que o erro. Um
 * verdict não-parseável **é** recuperável: o loop decide por falhas consecutivas, política
 * documentada em `judge-call.ts:44-48`, e abortar nela quebraria goals que hoje funcionam.
 *
 * ## Uma correção ao blueprint deste milestone
 *
 * O blueprint concluiu que `blocked` "já está no vocabulário" — verdadeiro para
 * `GoalResult.status` (`types/goal-events.ts:60`) e **falso** para o verdict do judge, que é
 * `"done" | "continue" | "skipped"`. Eu li metade da DoD e declarei a outra metade pronta. O teste
 * abaixo cobre a metade que faltava.
 */
import { describe, expect, it } from "vitest";

import { TheokitAgentError } from "../src/errors.js";
import type { JudgeContext } from "../src/internal/judge/judge-call.js";
import { judgeCallImpl } from "../src/internal/judge/judge-call.js";

const ctx = { goal: "fazer X", lastResponse: "fiz X", turnsUsed: 1 } as unknown as JudgeContext;

/** Agente falso: registra o modelo pedido e devolve o texto configurado (ou lança). */
function agenteFalso(comportamento: { texto?: string; erro?: Error }) {
  const modelos: string[] = [];
  const chaves: (string | undefined)[] = [];
  return {
    modelos,
    chaves,
    deps: {
      create: async (options: { model?: { id?: string }; apiKey?: string }) => {
        modelos.push(options.model?.id ?? "(sem modelo)");
        chaves.push(options.apiKey);
        return {
          send: async () => {
            if (comportamento.erro !== undefined) throw comportamento.erro;
            return { wait: async () => ({ result: comportamento.texto ?? "" }) };
          },
          dispose: async () => undefined,
        };
      },
    } as never,
  };
}

describe("M80 T1.1 — judge provider-aware", () => {
  it("test_judge_deriva_o_modelo_do_agente_conduzido", async () => {
    const a = agenteFalso({ texto: "DONE: pronto" });
    await judgeCallImpl(ctx, { apiKey: "sk-x", agentModel: "anthropic/claude-4" }, a.deps);

    expect(
      a.modelos[0],
      "sem `judgeModel` explícito, o judge tem de seguir o modelo do agente conduzido — " +
        "o default fixo só resolve em OpenRouter",
    ).toBe("anthropic/claude-4");
  });

  it("test_judgeModel_explicito_VENCE_a_derivacao", () => {
    // CONTRAPROVA: a derivação é o DEFAULT, não uma imposição. O A/B do M64 mostrou o judge barato
    // vencendo em goals curtos, e quem sabe disso precisa poder dizer.
    const a = agenteFalso({ texto: "DONE: pronto" });
    return judgeCallImpl(
      ctx,
      { apiKey: "sk-x", agentModel: "anthropic/claude-4", judgeModel: "openai/gpt-4o-mini" },
      a.deps,
    ).then(() => {
      expect(a.modelos[0]).toBe("openai/gpt-4o-mini");
    });
  });

  it("test_401_lanca_erro_TIPADO_e_nao_dobra_em_parseFailed", async () => {
    // O caso que hoje queima 3 turnos: a credencial não serve para o judge, e o loop trata como
    // "continue" três vezes antes de desistir com razão enganosa.
    const a = agenteFalso({ erro: Object.assign(new Error("401 Unauthorized"), { status: 401 }) });

    await expect(
      judgeCallImpl(ctx, { apiKey: "sk-ruim", agentModel: "m" }, a.deps),
    ).rejects.toBeInstanceOf(TheokitAgentError);
  });

  it("test_404_de_modelo_lanca_erro_TIPADO", async () => {
    const a = agenteFalso({
      erro: Object.assign(new Error("404 model not found"), { status: 404 }),
    });

    await expect(
      judgeCallImpl(ctx, { apiKey: "sk-x", agentModel: "inexistente/modelo" }, a.deps),
    ).rejects.toBeInstanceOf(TheokitAgentError);
  });

  it("test_CONTRAPROVA_falha_de_PARSE_continua_dobrada", async () => {
    // A metade que NÃO pode virar fail-fast. Um verdict não-parseável é recuperável — o loop decide
    // por falhas consecutivas (`judge-call.ts:44-48`), e abortar nele quebraria goals que funcionam.
    const a = agenteFalso({ texto: "texto que não começa com nenhum prefixo canônico" });
    const r = await judgeCallImpl(ctx, { apiKey: "sk-x", agentModel: "m" }, a.deps);

    expect(r.parseFailed).toBe(true);
    expect(r.verdict).toBe("continue");
  });

  it("test_CONTRAPROVA_erro_de_REDE_tambem_continua_dobrado", async () => {
    // Sem esta, "fail-fast em erro" viraria fail-fast em TUDO. Um timeout de rede é transiente; o
    // loop deve poder tentar de novo, como sempre pôde.
    const a = agenteFalso({ erro: new Error("ETIMEDOUT") });
    const r = await judgeCallImpl(ctx, { apiKey: "sk-x", agentModel: "m" }, a.deps);

    expect(r.parseFailed).toBe(true);
  });

  it("test_blocked_entra_no_vocabulario_de_VERDICT", async () => {
    // A metade da DoD 3 que o blueprint deste milestone declarou pronta por engano: `blocked` já
    // existia em `GoalResult.status`, mas o verdict do judge era `done | continue | skipped`. Sem
    // ele, o judge não tem como dizer "impossível prosseguir" — só "continue", que o loop repete.
    const a = agenteFalso({ texto: "BLOCKED: o mesmo bloqueio recorreu" });
    const r = await judgeCallImpl(ctx, { apiKey: "sk-x", agentModel: "m" }, a.deps);

    expect(r.verdict).toBe("blocked");
    expect(r.parseFailed, "`blocked` é verdict legítimo, não falha de parse").toBe(false);
  });
});
