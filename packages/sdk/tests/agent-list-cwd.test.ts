/**
 * M107 T1.3 — `Agent.list` passa a LER o `cwd` que o seu tipo já promete.
 *
 * ## O defeito, e por que ele é caro
 *
 * `ListAgentsOptions` declara `{ runtime: "local"; cwd?: string }` desde sempre, mas `Agent.list`
 * hidratava `hydrateRegistryFromDisk(process.cwd())` com o `cwd` **fixo** e devolvia todo o mapa em
 * memória. Ou seja: `Agent.list({ runtime: "local", cwd: "/outro/projeto" })` **compilava e era
 * silenciosamente ignorado** — um valor mágico em vez de um erro
 * (`.claude/rules/error-handling.md § 2`).
 *
 * A consequência não é estética. A listagem alimenta `activeKnown` no coletor de sessões do
 * consumidor, que é uma das cinco guardas NEVER-delete de `.claude/rules/audit-trail-rotation.md`,
 * num caminho que chama `unlink`. Como a hidratação era fixa, a guarda alcançava **um** projeto —
 * medido: 1 de 10.982 — e a regra declara esse resíduo por escrito há dois milestones. Honrar o
 * `cwd` é o que fecha a guarda; nenhum conserto do lado do consumidor conseguiria, porque
 * reimplementar a leitura do registry num caminho destrutivo é o que a Regra Inquebrável 9 proíbe.
 *
 * ## A regra do filtro é a MESMA da persistência (EC-7 — completude, não só correção)
 *
 * `cwd` é **opcional** em `RegisteredAgent`, e `resolveRegistryCwd` já resolve a ausência para
 * `process.cwd()` — é assim que a entrada é ROTEADA para um arquivo em disco. O filtro reusa
 * exatamente essa função, e não `agent.cwd === cwd`. A diferença importa: com a comparação ingênua,
 * toda entrada sem `cwd` sumiria da listagem do próprio diretório do processo, e uma entrada que
 * some de `activeKnown` é uma entrada que o coletor deixa de proteger.
 * `test_uma_entrada_sem_cwd_pertence_ao_cwd_do_processo` é essa asserção.
 *
 * ## Decisão sobre `cursor` e `limit` (Q5 do plano) — NÃO entram, e os dois juntos
 *
 * A pergunta aberta era se a forma do cursor "cabe numa frase". Cabe — *"o cursor é o `agentId` do
 * último item da página, e a próxima página é o que vem depois dele na ordem estável"* — mas a
 * cláusula final é o problema: **não existe ordem estável hoje**. `listRegisteredAgents` devolve a
 * ordem de inserção de um `Map`, que varia com a ordem de hidratação. Impor `ORDER BY agentId`
 * mudaria a ordem observada por **todo** chamador atual, o que não é aditivo e não cabe num minor.
 *
 * E `limit` não pode entrar sozinho: `limit` sem `nextCursor` é **truncamento silencioso** — exatamente
 * a armadilha latente que o `CursorNaoDrenadoError` do consumidor existe para pegar, e num caminho
 * que apaga arquivo. Entregar meia paginação seria trocar "parâmetro ignorado" por "página parcial
 * apresentada como população completa", que é estritamente pior.
 *
 * Nada está esperando por eles: o consumidor não passa `limit` (o tipo da camada ainda o fecha) e o
 * item medido como acionável é o `cwd`. Rung 1 da escada de parsimônia — o que não precisa existir
 * agora não é escrito agora. **Resíduo declarado:** o bloco de estreitamento de `limit`/`cursor` na
 * camada continua valendo e precisa de asserção própria citando seu critério de saída (EC-14),
 * trabalho da Fase 2 deste plano.
 *
 * ## Por que este arquivo NÃO é `tests/contract/agent-management.contract.test.ts`
 *
 * O plano nomeia aquele arquivo, e o critério de aceite manda `npx vitest run
 * packages/sdk/tests/contract/agent-management.contract.test.ts` retornar 0. **Medido: esse comando
 * retorna 1** — `vitest.config.ts` lista `tests/contract/**` em `exclude`, e a saída é literalmente
 * `No test files found, exiting with code 1`. Aquele diretório só roda em `pnpm test:roadmap`.
 * Escrever a trava lá produziria um gate que nunca roda no portão real (`pnpm test`) com um critério
 * de aceite impossível de satisfazer — vacuidade da forma que
 * `.claude/rules/mecanismo-anti-esquecimento.md § 5.4` manda evitar. Aqui, o arquivo é coletado pelo
 * `include` padrão.
 *
 * ## A corrida que este arquivo ENCONTROU (não previu)
 *
 * `test_duas_hidratacoes_simultaneas_do_mesmo_cwd_nao_duplicam_entradas` continuou vermelho depois de
 * `Agent.list` já honrar o `cwd`, e o motivo é um defeito **preexistente**: `hydrateRegistryFromDisk`
 * marcava o `cwd` como hidratado ANTES do `await` da leitura em disco, então a segunda chamada
 * concorrente via a marca e retornava de imediato — listando um registro ainda vazio. O sintoma não é
 * entrada duplicada, que era o que o plano temia; é entrada **ausente**, que é o lado perigoso num
 * consumidor cuja listagem alimenta `activeKnown`. O conserto foi memoizar a PROMESSA, não a flag.
 *
 * ## Contraprova por mutação (EXECUTADA; a coluna é o que caiu, não o previsto)
 *
 * | # | Mutação | Caiu | Testes que morreram |
 * |---|---|---|---|
 * | D | `agent.ts`: `hydrateRegistryFromDisk(cwd)` → `(process.cwd())` | 4/6 | estrangeiro, não-contaminação, e as duas de concorrência |
 * | E | `agent-registry.ts`: `listRegisteredAgents` ignora o parâmetro `cwd` | 3/6 | não-contaminação, `sem_cwd`, concorrência de cwds diferentes |
 * | F | `agent-registry.ts`: `agent.cwd === cwd` em vez de `resolveRegistryCwd` | 1/6 | `test_uma_entrada_sem_cwd_pertence_ao_cwd_do_processo` (EC-7) |
 * | G | `agent-registry.ts`: memoizar a flag antes do `await`, como era | 1/6 | `test_duas_hidratacoes_simultaneas_do_mesmo_cwd_nao_duplicam_entradas` |
 *
 * F e G matam **um teste cada, e o certo** — são as duas asserções que nenhuma outra cobre.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Agent } from "../src/index.js";
import {
  clearAgentRegistry,
  flushRegistrySaves,
  registerAgent,
  removeRegisteredAgent,
} from "../src/internal/runtime/registry/agent-registry.js";
import type { RegisteredAgent } from "../src/internal/runtime/registry/agent-registry-contract.js";

/** Uma entrada de registry mínima — `agent-*` é o prefixo que a marca como local. */
function entrada(agentId: string, cwd?: string): RegisteredAgent {
  return {
    agentId,
    runtime: "local",
    createdAt: 1,
    lastModified: 1,
    archived: false,
    options: {},
    ...(cwd === undefined ? {} : { cwd }),
  };
}

/** Registra em memória E espera a gravação em disco daquele `cwd`. */
async function persistir(agentId: string, cwd: string): Promise<void> {
  registerAgent(entrada(agentId, cwd));
  await flushRegistrySaves(cwd);
}

const ids = (r: { items: { agentId: string }[] }): string[] => r.items.map((i) => i.agentId);

let projetos: string[] = [];

function projeto(): string {
  const p = mkdtempSync(join(tmpdir(), "m107-list-cwd-"));
  projetos.push(p);
  return p;
}

beforeEach(() => {
  clearAgentRegistry();
});

afterEach(async () => {
  // `agent-sem-cwd` é roteado para `process.cwd()`, ou seja, para o registry do PRÓPRIO repositório
  // (`packages/sdk/.theokit/agents/registry.json`, gitignored). Deixá-lo lá contaminaria qualquer
  // teste futuro que liste o cwd do processo — o tipo de estado compartilhado que a nota EC-7 do
  // `vitest.config.ts` manda cada teste limpar por conta própria.
  removeRegisteredAgent("agent-sem-cwd");
  await flushRegistrySaves();
  clearAgentRegistry();
  for (const p of projetos) rmSync(p, { recursive: true, force: true });
  projetos = [];
});

describe("M107 T1.3 — Agent.list honra o cwd que o tipo promete", () => {
  it("test_list_com_cwd_estrangeiro_devolve_as_entradas_daquele_cwd", async () => {
    // Arrange — a entrada existe EM DISCO num projeto que não é o do processo, e o registro em
    // memória é limpo. Sem limpar, a entrada voltaria da memória e o teste passaria por acidente.
    const outroProjeto = projeto();
    await persistir("agent-estrangeiro", outroProjeto);
    clearAgentRegistry();

    // Act
    const r = await Agent.list({ runtime: "local", cwd: outroProjeto });

    // Assert — hoje devolve `[]`: é o teste que falha ANTES e o que fecha a guarda declarada.
    expect(ids(r)).toContain("agent-estrangeiro");
  });

  it("test_list_de_um_cwd_inexistente_devolve_lista_vazia_sem_lancar", async () => {
    // Arrange — CASO NEGATIVO. Um projeto sem registry e um projeto apagado do disco são o mesmo
    // desfecho, e o coletor de sessões DEPENDE de que isso não lance.
    const inexistente = join(tmpdir(), "m107-nao-existe-de-jeito-nenhum-xyz");

    // Act
    const r = await Agent.list({ runtime: "local", cwd: inexistente });

    // Assert
    expect(r.items).toEqual([]);
  });

  it("test_listar_um_cwd_estrangeiro_nao_contamina_a_listagem_de_outro_cwd", async () => {
    // Arrange — o INVARIANTE DE GUARDA da task. O mapa em memória é global ao processo, então
    // hidratar um `cwd` estrangeiro despeja as entradas dele nesse mapa. Se a listagem não filtrasse,
    // o projeto B passaria a "ter" as sessões do projeto A — e é `activeKnown`, numa guarda de
    // NEVER-delete, que consumiria isso.
    const projetoA = projeto();
    const projetoB = projeto();
    await persistir("agent-so-do-A", projetoA);
    await persistir("agent-so-do-B", projetoB);
    clearAgentRegistry();

    // Act — a ordem importa: A primeiro, para que suas entradas estejam no mapa quando B for lido.
    await Agent.list({ runtime: "local", cwd: projetoA });
    const b = await Agent.list({ runtime: "local", cwd: projetoB });

    // Assert
    expect(ids(b)).toContain("agent-so-do-B");
    expect(ids(b), "as entradas do projeto A vazaram para a listagem do projeto B").not.toContain(
      "agent-so-do-A",
    );
  });

  it("test_uma_entrada_sem_cwd_pertence_ao_cwd_do_processo", async () => {
    // Arrange — EC-7, a metade de COMPLETUDE. `cwd` é opcional em `RegisteredAgent`, e a ausência já
    // significa `process.cwd()` para efeito de ROTEAMENTO em disco. O filtro tem de usar a mesma
    // regra, ou toda entrada sem `cwd` sumiria da listagem do próprio projeto.
    const outroProjeto = projeto();
    registerAgent(entrada("agent-sem-cwd"));

    // Act
    const doProcesso = await Agent.list({ runtime: "local" });
    const doOutro = await Agent.list({ runtime: "local", cwd: outroProjeto });

    // Assert
    expect(ids(doProcesso), "uma entrada sem cwd sumiu da listagem do cwd do processo").toContain(
      "agent-sem-cwd",
    );
    expect(ids(doOutro)).not.toContain("agent-sem-cwd");
  });

  it("test_duas_hidratacoes_simultaneas_do_mesmo_cwd_nao_duplicam_entradas", async () => {
    // Arrange — atomic-counter invariant sobre a guarda de memoização por `cwd`
    // (`agent-registry.ts`: `hydratedCwds`). Passar a hidratar `cwd` arbitrário multiplica as
    // combinações, e é onde uma corrida produziria entrada duplicada.
    const projetoA = projeto();
    await persistir("agent-duplo", projetoA);
    clearAgentRegistry();

    // Act
    const [a, b] = await Promise.all([
      Agent.list({ runtime: "local", cwd: projetoA }),
      Agent.list({ runtime: "local", cwd: projetoA }),
    ]);

    // Assert (happens-before observation, depois da barreira)
    expect(ids(a).filter((i) => i === "agent-duplo")).toHaveLength(1);
    expect(ids(b).filter((i) => i === "agent-duplo")).toHaveLength(1);
  });

  it("test_hidratacoes_simultaneas_de_cwds_DIFERENTES_nao_se_misturam", async () => {
    // Arrange — a mesma não-contaminação, agora sem a barreira sequencial que a esconderia.
    const projetoA = projeto();
    const projetoB = projeto();
    await persistir("agent-concorrente-A", projetoA);
    await persistir("agent-concorrente-B", projetoB);
    clearAgentRegistry();

    // Act
    const [a, b] = await Promise.all([
      Agent.list({ runtime: "local", cwd: projetoA }),
      Agent.list({ runtime: "local", cwd: projetoB }),
    ]);

    // Assert
    expect(ids(a)).toEqual(["agent-concorrente-A"]);
    expect(ids(b)).toEqual(["agent-concorrente-B"]);
  });
});
