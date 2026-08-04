/**
 * M82 T1.1/T1.2 — o seam `transform_tool_result` recebe as tool calls do turn.
 *
 * ## A assimetria que este teste fecha
 *
 * Two channels observe the end of a tool, and each has HALF of what a policy needs:
 *
 * | | `post_tool_call` | `transform_tool_result` |
 * |---|---|---|
 * | knows the tool | **yes** (`name`, `args`, `result`) | no |
 * | return honored | **no** (`#runFireAndForget` discards) | **yes** (`#runTransform` folds) |
 *
 * Downstream consequence: a `PostToolUse` hook WITH a matcher — that is, a scoped policy — could only
 * be registered on the channel that discards the return, becoming silent observation. The consumer
 * went as far as emitting a WARN asking the user to REMOVE the scope in order to get feedback: the product
 * instructing them to weaken their own policy.
 *
 * ## Why `toolCalls` (plural) and not `name` (singular)
 *
 * The seam is NOT per tool. `guardAndTransformToolResults` receives the turn's BATCH of results
 * (`dispatchTools` roda todas as tool calls juntas). Num turn com duas tools, um campo `name`
 * a singular one would have to lie about one of them — worse than the gap, because it gives the hook author the
 * impression of precise scope the data does not support.
 *
 * The exact correlation already exists in the format: `LlmToolResultPart.toolUseId` <-> `LlmToolCallPart.id`. What
 * was missing was not a name, it was the turn's LIST of calls — which the seam's caller already had in
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

/** The shape the seam actually carries: content parts, of which only `tool_result` matters. */
interface ParteDeResultado {
  type: string;
  toolUseId?: string;
  content?: unknown;
}

/** `toolUseId` -> content, resolved by the tool's NAME. It is the whole correlation, isolated from the test. */
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
    let seen: ToolResultTransformContext | undefined;
    const mgr = new PluginManager();
    await mgr.initialize([
      pluginTransform((results, ctx) => {
        seen = ctx as ToolResultTransformContext;
        return results;
      }),
    ]);

    await runAgentLoop(
      inputs(llmComToolCalls([{ type: "tool_use", id: "call-1", name: "alpha", input: {} }]), mgr, [
        "alpha",
      ]),
    );

    expect(seen, "the hook did not even run — the seam was not exercised").toBeDefined();
    expect(
      seen?.toolCalls,
      "sem as tool calls do turn nenhum hook consegue honrar um matcher",
    ).toEqual([{ id: "call-1", name: "alpha", args: {} }]);
  });

  it("test_ctx_correlaciona_toolUseId_com_o_nome_da_tool_em_turn_de_DUAS_tools", async () => {
    // The case a singular `name` field could not represent (ADR-2), and the same case as
    // risk R1: if the correlation fails, a scoped hook transforms the WRONG tool's result.
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
    // ADR-1: `TransformContext` also serves `transform_llm_output`, which has no tool call at all.
    // An optional `toolCalls?` there would always be `undefined` for half the consumers — the type
    // mentiria. Sem esta contraprova, resolver T1.1 poluindo o tipo compartilhado passaria.
    const base: TransformContext = { agentId: "a", runId: "r" };
    // @ts-expect-error — `toolCalls` does NOT belong to the shared context.
    const proibido = base.toolCalls;
    expect(proibido).toBeUndefined();
    expect(base.agentId).toBe("a");
  });
});
