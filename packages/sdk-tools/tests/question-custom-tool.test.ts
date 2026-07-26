/**
 * M76 T1.1 — `createQuestionTool` passa a devolver o contrato canônico.
 *
 * ## O delta é UM campo
 *
 * `QuestionTool` era uma interface própria com `inputSchema: unknown`, enquanto `CustomTool` declara
 * `inputSchema: Record<string, unknown>`. Nome, descrição e handler já eram estruturalmente
 * compatíveis — um handler de 1 argumento satisfaz um tipo de 2 argumentos opcionais.
 *
 * Estreitar é **aditivo**: o valor em runtime SEMPRE foi um objeto (a implementação constrói
 * `{ type: "object", properties: {…}, required: ["question"] }`); só o tipo declarado estava frouxo.
 * Quebraria apenas quem passasse um não-objeto, coisa que a fábrica nunca produz.
 *
 * ## Por que isso importa fora do SDK
 *
 * O consumidor era obrigado a escrever DOIS casts para registrar a tool
 * (`agent-builder/agents/chat.ts:94-95`). Cast é a assinatura de um contrato que não fecha: ele não
 * conserta o tipo, apenas silencia o compilador — e silenciar aqui significa que uma mudança de
 * assinatura no SDK chegaria ao consumidor como erro de runtime, não de compilação.
 *
 * ## O que o vitest NÃO prova aqui
 *
 * A compatibilidade é um fato de TIPO. O vitest transpila sem checar tipos, então o teste de
 * atribuição abaixo passaria mesmo com o contrato quebrado — é `tsc --noEmit` que o prova, e o AC da
 * tarefa exige `tsc` verde por isso. Foi um erro cometido três vezes no M75; aqui está escrito.
 */
import { describe, expect, it } from "vitest";

import { createQuestionTool } from "../src/question.js";

const askerFalso = async (): Promise<string> => "resposta";

describe("M76 T1.1 — o contrato de question fecha sem cast", () => {
  it("test_input_schema_e_objeto_em_runtime", () => {
    // A base do argumento de que estreitar é aditivo: o valor JÁ é o que o tipo estreito declara.
    const t = createQuestionTool({ askUser: askerFalso });
    const schema = t.inputSchema as Record<string, unknown>;
    expect(typeof schema).toBe("object");
    expect(schema.type).toBe("object");
    expect(schema.required).toEqual(["question"]);
  });

  it("test_o_schema_e_indexavel_como_record", () => {
    // `unknown` não é indexável; `Record<string, unknown>` é. Este teste falha na COMPILAÇÃO com o
    // tipo antigo — e é essa falha, não a execução, que prova a mudança.
    const t = createQuestionTool({ askUser: askerFalso });
    const props = t.inputSchema.properties;
    expect(props).toBeDefined();

    // M76 review (M5) — `toBeDefined()` sozinho passa com `properties: {}`. A chave `question` é o
    // contrato: o handler lê `input.question`, então um schema sem essa chave produz uma tool que o
    // modelo chama sempre sem argumento. É a indexação que prova o tipo E a forma ao mesmo tempo.
    expect(Object.keys(props as Record<string, unknown>)).toContain("question");
    expect(t.inputSchema["required"]).toEqual(["question"]);
  });

  it("test_handler_de_um_argumento_continua_valido", () => {
    // Retrocompatibilidade do handler: quem chama com 1 argumento não muda. O 2º (`ctx`) é opcional.
    const t = createQuestionTool({ askUser: askerFalso });
    expect(t.handler.length).toBeLessThanOrEqual(2);
  });

  it("test_nome_e_descricao_seguem_os_defaults_de_hoje", () => {
    // ÂNCORA: se a promoção mudasse o default silenciosamente, o modelo veria outra tool e os
    // approvals gravados por nome deixariam de casar. O nome é contrato, não rótulo (blueprint Q1).
    const t = createQuestionTool({ askUser: askerFalso });
    expect(t.name).toBe("question");
    expect(t.description).toContain("Ask the user a question");
  });
});
