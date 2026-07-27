/**
 * M82 T1.1/T1.2 — o seam `transform_tool_result` recebe as tool calls do turn.
 *
 * ## A assimetria que este teste fecha
 *
 * Dois canais observam o fim de uma tool, e cada um tem METADE do que uma política precisa:
 *
 * | | `post_tool_call` | `transform_tool_result` |
 * |---|---|---|
 * | sabe a tool | **sim** (`name`, `args`, `result`) | não |
 * | retorno honrado | **não** (`#runFireAndForget` descarta) | **sim** (`#runTransform` dobra) |
 *
 * Consequência a jusante: um hook `PostToolUse` COM matcher — isto é, uma política com escopo — só
 * podia ser registrado no canal que descarta o retorno, virando observação silenciosa. O consumidor
 * chegou a emitir um WARN pedindo ao usuário para REMOVER o escopo para receber feedback: o produto
 * instruindo a enfraquecer a própria política.
 *
 * ## Por que `toolCalls` (plural) e não `name` (singular)
 *
 * O seam NÃO é por tool. `guardAndTransformToolResults` recebe o LOTE de resultados do turn
 * (`dispatchTools` roda todas as tool calls juntas). Num turn com duas tools, um campo `name`
 * singular teria de mentir sobre uma delas — pior que a lacuna, porque dá ao autor de hook a
 * impressão de escopo preciso que o dado não sustenta.
 *
 * A correlação exata já existe no formato: `LlmToolResultPart.toolUseId` ↔ `LlmToolCallPart.id`. O
 * que faltava não era um nome, era a LISTA de chamadas do turn — que o chamador do seam já tinha em
 * escopo (`llmOutput.toolCalls`) e simplesmente descartava.
 */
import { describe, expect, it } from "vitest";

import { runAgentLoop } from "../src/internal/agent-loop/loop.js";
import type { AgentLoopInputs } from "../src/internal/agent-loop/loop-types.js";
import type { LlmClient, LlmEvent, LlmFinish, LlmToolCallPart } from "../src/internal/llm/types.js";
import { PluginManager } from "../src/internal/plugins/manager.js";
import type { Plugin } from "../src/internal/plugins/types.js";
import { HooksExecutor } from "../src/internal/runtime/hooks/hooks-executor.js";
import type { ToolResultTransformContext, TransformContext } from "../src/types/plugin.js";

/** A forma que o seam realmente carrega: partes de conteúdo, das quais só `tool_result` interessa. */
interface ParteDeResultado {
  type: string;
  toolUseId?: string;
  content?: unknown;
}

/** `toolUseId` → conteúdo, resolvido pelo NOME da tool. É a correlação inteira, isolada do teste. */
function porNomeDeTool(results: unknown, ctx: ToolResultTransformContext): Record<string, string> {
  const porId = new Map(ctx.toolCalls.map((t) => [t.id, t.name]));
  const saida: Record<string, string> = {};
  for (const parte of results as ParteDeResultado[]) {
    if (parte.type !== "tool_result") continue;
    const nome = porId.get(parte.toolUseId ?? "");
    if (nome !== undefined) saida[nome] = String(parte.content);
  }
  return saida;
}

/** LLM que emite as tool calls pedidas no 1º turn e encerra no 2º. */
function llmComToolCalls(calls: readonly LlmToolCallPart[]): LlmClient {
  let turn = 0;
  return {
    name: "mock",
    async *stream(): AsyncGenerator<LlmEvent, LlmFinish, void> {
      yield { type: "text_delta", text: "" };
      turn += 1;
      if (turn === 1) {
        return {
          stopReason: "tool_use",
          text: "",
          toolCalls: [...calls],
          inputTokens: 1,
          outputTokens: 1,
        };
      }
      return {
        stopReason: "end_turn",
        text: "done",
        toolCalls: [],
        inputTokens: 1,
        outputTokens: 1,
      };
    },
  };
}

function inputs(llm: LlmClient, mgr: PluginManager, tools: readonly string[]): AgentLoopInputs {
  return {
    agentId: "m82",
    runId: "run-1",
    userMessage: "go",
    model: { id: "mock-model" },
    llm,
    mcp: new Map(),
    hooks: new HooksExecutor(process.cwd()),
    shellCwd: process.cwd(),
    shellSandbox: false,
    maxIterations: 4,
    customTools: tools.map((name) => ({
      name,
      description: name,
      inputSchema: { type: "object" },
      handler: () => `resultado-de-${name}`,
    })),
    pluginManager: mgr,
  };
}

function pluginTransform(fn: (results: unknown, ctx: unknown) => unknown): Plugin {
  return {
    name: "p-transform",
    version: "1.0",
    kind: "general",
    register: (ctx) => ctx.on("transform_tool_result" as never, fn as never),
  };
}

describe("M82 — transform_tool_result recebe o contexto de tool call", () => {
  it("test_transform_tool_result_recebe_as_toolCalls_do_turn", async () => {
    let visto: ToolResultTransformContext | undefined;
    const mgr = new PluginManager();
    await mgr.initialize([
      pluginTransform((results, ctx) => {
        visto = ctx as ToolResultTransformContext;
        return results;
      }),
    ]);

    await runAgentLoop(
      inputs(llmComToolCalls([{ type: "tool_use", id: "call-1", name: "alpha", input: {} }]), mgr, [
        "alpha",
      ]),
    );

    expect(visto, "o hook nem rodou — o seam não foi exercitado").toBeDefined();
    expect(
      visto?.toolCalls,
      "sem as tool calls do turn nenhum hook consegue honrar um matcher",
    ).toEqual([{ id: "call-1", name: "alpha", args: {} }]);
  });

  it("test_ctx_correlaciona_toolUseId_com_o_nome_da_tool_em_turn_de_DUAS_tools", async () => {
    // O caso que um campo `name` singular não conseguiria representar (ADR-2), e o mesmo caso do
    // risco R1: se a correlação falhar, um hook com escopo transforma o resultado da tool ERRADA.
    const correlacionado: Record<string, string> = {};
    const mgr = new PluginManager();
    await mgr.initialize([
      pluginTransform((results, ctx) => {
        Object.assign(correlacionado, porNomeDeTool(results, ctx as ToolResultTransformContext));
        return results;
      }),
    ]);

    await runAgentLoop(
      inputs(
        llmComToolCalls([
          { type: "tool_use", id: "c-a", name: "alpha", input: {} },
          { type: "tool_use", id: "c-b", name: "beta", input: {} },
        ]),
        mgr,
        ["alpha", "beta"],
      ),
    );

    expect(correlacionado.alpha).toContain("resultado-de-alpha");
    expect(correlacionado.beta).toContain("resultado-de-beta");
  });

  it("test_CONTRAPROVA_TransformContext_compartilhado_NAO_ganhou_toolCalls", () => {
    // ADR-1: `TransformContext` também serve `transform_llm_output`, que não tem tool call nenhuma.
    // Um `toolCalls?` opcional lá seria sempre `undefined` para metade dos consumidores — o tipo
    // mentiria. Sem esta contraprova, resolver T1.1 poluindo o tipo compartilhado passaria.
    const base: TransformContext = { agentId: "a", runId: "r" };
    // @ts-expect-error — `toolCalls` NÃO pertence ao contexto compartilhado.
    const proibido = base.toolCalls;
    expect(proibido).toBeUndefined();
    expect(base.agentId).toBe("a");
  });
});
