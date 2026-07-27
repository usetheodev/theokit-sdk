/**
 * M81 T2.2 — `Squad.create` aceita `AgentDefinition`, não só `SDKAgent` já construído.
 *
 * ## O que mudou de fato
 *
 * `squad.ts` declarava `agents: ReadonlyArray<SDKAgent>`. Montar um time obrigava o chamador a
 * **materializar cada agente à mão** antes — resolver credencial, construir opções, chamar
 * `Agent.create`, aguardar. Isso é exatamente o trabalho que este milestone move para o framework nas
 * outras tarefas; deixá-lo aqui seria inconsistente.
 *
 * Com `discoverSubagents` público (T2.1), o dado que descreve um agente passou a ser alcançável pelo
 * consumidor. Aceitar esse dado direto fecha o circuito: descobrir → montar time, sem etapa manual
 * no meio.
 *
 * ## A metade que mais importa é a retrocompatibilidade
 *
 * `SDKAgent` construído continua aceito, e a mistura dos dois na mesma lista também — um time real
 * costuma ter agentes vindos de origens diferentes. Um teste que só provasse o caminho novo passaria
 * mesmo se o antigo tivesse quebrado.
 */
import { describe, expect, it } from "vitest";

import { Squad } from "../src/squad.js";
import type { AgentDefinition, SDKAgent } from "../src/types/agent.js";

const definicao: AgentDefinition = {
  description: "explora o repositório",
  prompt: "Você explora.",
};

/** Duplo mínimo de `SDKAgent` — o Squad só precisa que ele exista para compor o workflow. */
const agenteConstruido = { agentId: "ja-construido" } as unknown as SDKAgent;

describe("M81 T2.2 — Squad.create aceita AgentDefinition", () => {
  it("test_Squad_aceita_AgentDefinition_como_membro", () => {
    // O caminho novo: dado puro entra, o Squad materializa quando for rodar.
    const squad = Squad.create({ agents: [definicao] });
    expect(squad).toBeDefined();
    expect(squad.run).toBeTypeOf("function");
  });

  it("test_CONTRAPROVA_SDKAgent_ja_construido_continua_aceito", () => {
    // Sem esta, trocar o tipo por `AgentDefinition` puro passaria no teste acima e quebraria todo
    // consumidor existente em silêncio — o Squad não roda na construção, então a quebra só
    // apareceria no primeiro `run()`.
    const squad = Squad.create({ agents: [agenteConstruido] });
    expect(squad).toBeDefined();
  });

  it("test_aceita_MISTURA_dos_dois_na_mesma_lista", () => {
    // O caso real: um time com um agente vindo do disco e outro construído pelo app.
    const squad = Squad.create({ agents: [definicao, agenteConstruido] });
    expect(squad).toBeDefined();
  });

  it("test_a_materializacao_ACONTECE_de_fato_ao_rodar", async () => {
    // O teste que faltava, e a lacuna foi encontrada por mutação: trocar o type-guard por
    // `() => true` (tratando TODO membro como já construído) não matava nenhum teste, porque os
    // outros só provam que o TIPO aceita — nunca que a materialização roda.
    //
    // A asserção é POSITIVA de propósito. A primeira versão dizia
    // `.not.toContain("send is not a function")` — um negativo que a mutação não movia, porque o
    // run falha antes por outra razão e o negativo ficava vacuamente verdadeiro.
    //
    // `definicao` não declara modelo, então uma materialização BEM-SUCEDIDA chega ao `Agent.create`
    // e falha ali com "requires a model selection". Essa mensagem específica só é alcançável se
    // alguém transformou o dado em agente — é a prova de que a materialização rodou.
    const squad = Squad.create({ agents: [definicao] });
    const err = await squad.run("oi").catch((e: unknown) => e);

    expect(
      String(err instanceof Error ? err.message : err),
      "não chegou ao `Agent.create` — o AgentDefinition foi tratado como agente já construído",
    ).toContain("model selection");
  });

  it("test_lista_vazia_continua_sendo_erro_TIPADO", () => {
    // A validação existente não pode regredir ao ganhar a união no tipo.
    expect(() => Squad.create({ agents: [] })).toThrow();
  });
});
