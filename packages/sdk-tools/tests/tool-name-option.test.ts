/**
 * M76 T1.2 — nome e descrição viram opções de fábrica.
 *
 * ## Por que na fábrica, e não só no decorator
 *
 * No Codex — a referência única deste projeto — o nome nasce na definição da tool
 * (`core/src/tools/handlers/agent_jobs_spec.rs:63`: `ToolSpec::Function(ResponsesApiTool { name: … })`)
 * e é consumido como **chave de decisão de approval** (`core/src/tools/approvals.rs:319`:
 * `flat_tool_name(&tool_ctx.tool_name)`), além de ser o que o modelo vê e o que o telemetry registra.
 *
 * Três consumidores de uma string decidida num lugar só. Tratá-la como decorator pós-hoc produziu, no
 * agent-builder, quatro renomeações empilhadas no ponto de composição — `registry.ts:97,104,107` e
 * `subagents/analyst.ts:28` — e um nome que só existe depois que a tool já foi construída.
 *
 * ## O que estes testes protegem
 *
 * A mudança é **aditiva**, e o teste que mais importa é o do DEFAULT: omitir a opção tem de produzir
 * exatamente o literal de hoje. Se o default escorregasse, o modelo veria outra tool e — pior — os
 * approvals gravados por nome deixariam de casar, silenciosamente.
 *
 * `withName`/`withDescription` continuam existindo para o caso dinâmico; o último teste garante que
 * não regridem.
 */
import { describe, expect, it } from "vitest";
import { withName } from "../src/internal/tool-aci.js";
import { createListDirTool } from "../src/list-dir.js";
import { createSearchTextTool } from "../src/search-text.js";

const raiz = "/tmp";

describe("M76 T1.2 — name/description como opção de fábrica", () => {
  it("test_name_da_fabrica_vence_o_default", () => {
    const t = createSearchTextTool({ projectRoot: raiz, name: "grep" });
    expect(t.name).toBe("grep");
  });

  it("test_description_da_fabrica_vence_o_default", () => {
    const t = createSearchTextTool({ projectRoot: raiz, description: "Busca literal ou regex." });
    expect(t.description).toBe("Busca literal ou regex.");
  });

  it("test_sem_name_o_default_e_preservado", () => {
    // O teste mais importante: retrocompatibilidade. Um default que escorrega muda a tool que o
    // modelo vê e quebra approvals gravados por nome — sem erro, sem log.
    expect(createSearchTextTool({ projectRoot: raiz }).name).toBe("search_text");
    expect(createListDirTool({ projectRoot: raiz }).name).toBe("list_dir");
  });

  it("test_sem_description_o_default_e_preservado", () => {
    const t = createSearchTextTool({ projectRoot: raiz });
    expect(t.description.length).toBeGreaterThan(0);
    expect(t.description).not.toBe("");
  });

  it("test_with_name_continua_funcionando", () => {
    // O caminho dinâmico não regride: renomear DEPOIS segue possível para quem precisa decidir o
    // nome fora da construção.
    const t = withName(createSearchTextTool({ projectRoot: raiz }), "grep");
    expect(t.name).toBe("grep");
  });

  it("test_a_opcao_e_o_decorator_concordam", () => {
    // ÂNCORA: os dois caminhos produzem o MESMO nome. Se divergissem, teríamos duas fontes de
    // verdade para a chave de approval — exatamente o defeito que este milestone existe para fechar.
    const viaOpcao = createSearchTextTool({ projectRoot: raiz, name: "grep" });
    const viaDecorator = withName(createSearchTextTool({ projectRoot: raiz }), "grep");
    expect(viaOpcao.name).toBe(viaDecorator.name);
  });
});
