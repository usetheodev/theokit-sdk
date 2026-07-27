/**
 * `createSquad` — a sequential team of agents.
 *
 * A Squad is a thin convenience that COMPOSES `Workflow` + `agentStep` — it
 * adds NO new orchestration logic. Agents run in array order; each agent's
 * output is threaded into the next agent's prompt. For branching/parallel/
 * foreach teams use `Workflow` directly; for manager→worker delegation use
 * subagents or `@theokit/sdk-handoff`.
 *
 * Mirrors the `createAgentFactory` composition-LEGO precedent (a factory over
 * existing primitives, not a new subsystem).
 *
 * @public
 */

import { ConfigurationError } from "./errors.js";
import type { AgentDefinition, SDKAgent } from "./types/agent.js";
import type { StepResult } from "./types/workflow.js";
import { agentStep, Workflow } from "./workflow.js";

/**
 * Options for {@link createSquad}.
 *
 * @public
 */
export interface SquadOptions {
  /**
   * Agents run in array order (sequential pipeline). Must be non-empty.
   *
   * M81 — accepts an `AgentDefinition` (plain data) as well as a constructed `SDKAgent`. Building a
   * team used to force the caller to materialize every member by hand first: resolve the credential,
   * assemble the options, call `Agent.create`, await. That is precisely the work this milestone moves
   * into the framework elsewhere, so leaving it here would be inconsistent — and with
   * `discoverSubagents` now public (`@theokit/sdk/subagents-loader`), the data that describes an
   * agent is reachable, which closes the loop: discover → build a team, with no manual step between.
   *
   * Mixing both forms in one list is supported on purpose: a real team usually has members from
   * different origins.
   */
  agents: ReadonlyArray<SDKAgent | AgentDefinition>;
  /**
   * Orchestration process. Only `"sequential"` is supported (the default).
   * `"hierarchical"` is accepted by the type but rejected at runtime with
   * guidance — use subagents or `@theokit/sdk-handoff` for manager→worker
   * delegation (those already cover it).
   */
  process?: "sequential" | "hierarchical";
  /** Optional squad name (surfaced on the underlying workflow). Default `"squad"`. */
  name?: string;
}

/**
 * Result of a {@link Squad.run}. `result` is the final (last agent's) output;
 * `steps` is the per-agent trace from the underlying workflow run.
 *
 * @public
 */
export interface SquadRun {
  readonly result: unknown;
  readonly status: "running" | "completed" | "failed" | "suspended" | "cancelled";
  readonly steps: ReadonlyArray<StepResult>;
}

/**
 * A sequential agent team produced by {@link createSquad}.
 *
 * @public
 */
export interface Squad {
  /** Run the team over `input`, threading each agent's output to the next. */
  run(input: unknown): Promise<SquadRun>;
}

/**
 * Build a sequential agent team. The returned {@link Squad} composes a
 * `Workflow` of `agentStep`s under the hood — all orchestration is delegated
 * to the workflow engine.
 *
 * @public
 */
/**
 * M81 — an `SDKAgent` is recognised by having `send`; an `AgentDefinition` is plain data.
 *
 * Structural, not `instanceof`: the definition crosses package boundaries as data (that is the whole
 * interop contract the layer relies on), so an identity check would fail exactly when two copies of
 * the SDK are loaded — the failure mode M79 measured.
 */
function ehAgenteConstruido(m: SDKAgent | AgentDefinition): m is SDKAgent {
  return typeof (m as SDKAgent).send === "function";
}

/**
 * M81 — transforma um `AgentDefinition` num agente executável.
 *
 * Import dinâmico do `Agent` porque `squad.ts` é consumido por caminhos que não querem arrastar o
 * agente inteiro só para declarar um time; o custo só é pago por quem de fato passa dado puro.
 */
async function materializar(def: AgentDefinition, indice: number): Promise<SDKAgent> {
  const { Agent } = await import("./agent.js");
  return Agent.create({
    // `AgentDefinition.model` admite o sentinel `'inherit'`, que não é um id de modelo. Herdar
    // aqui significa "não declare nada e deixe o default valer" — passar o literal adiante criaria
    // um agente pedindo um modelo chamado `inherit`.
    ...(def.model !== undefined && def.model !== "inherit" ? { model: def.model } : {}),
    ...(def.prompt !== undefined ? { systemPrompt: def.prompt } : {}),
    agentId: `squad-member-${String(indice)}`,
    local: {},
  });
}

function createSquad(options: SquadOptions): Squad {
  const { agents } = options;
  if (!Array.isArray(agents) || agents.length === 0) {
    throw new ConfigurationError("createSquad requires a non-empty `agents` array", {
      code: "invalid_squad",
    });
  }
  if (options.process !== undefined && options.process !== "sequential") {
    throw new ConfigurationError(
      `createSquad only supports process "sequential"; for manager→worker delegation use subagents or @theokit/sdk-handoff`,
      { code: "squad_process_unsupported" },
    );
  }

  return {
    run: async (input: unknown): Promise<SquadRun> => {
      const run = await (await montarPipeline(agents, options.name)).run(input);
      return { result: run.output, status: run.status, steps: run.stepResults };
    },
  };
}

/**
 * Monta o pipeline sequencial, materializando os membros que ainda são dado puro.
 *
 * Extraído de `run` porque o gate de complexidade cognitiva barrou a função combinada — e porque
 * "montar o pipeline" e "executar e traduzir o resultado" são duas responsabilidades que só estavam
 * juntas por proximidade.
 */
async function montarPipeline(
  agents: ReadonlyArray<SDKAgent | AgentDefinition>,
  nome: string | undefined,
): Promise<ReturnType<ReturnType<typeof Workflow.create>["commit"]>> {
  // Compose Workflow + agentStep — identity threading: each agent's prompt is the previous agent's
  // output (the run input for the first agent).
  let builder = Workflow.create({ name: nome ?? "squad" });
  for (let i = 0; i < agents.length; i++) {
    const membro = agents[i];
    if (membro === undefined) continue;
    // M81 — materializa na hora de RODAR, não na construção: `Squad.create` é síncrono e um
    // `AgentDefinition` só vira agente com um `await`. Adiar até aqui mantém a construção barata e
    // evita que montar um time exija credencial resolvida antes da primeira execução.
    const agent = ehAgenteConstruido(membro) ? membro : await materializar(membro, i);
    // SE3 — the first agent receives the human input (no peer origin); every subsequent agent
    // receives its predecessor's output, so its turn carries `{ kind: "peer", from: "agent-<i-1>" }`.
    const opts = i > 0 ? { origin: { kind: "peer" as const, from: `agent-${i - 1}` } } : undefined;
    builder = builder.then(agentStep(`agent-${i}`, agent, (prev) => String(prev), opts));
  }
  return builder.commit();
}

/** SE36 — `Squad.create` replaces `createSquad` (ADR 0015). Merges with the `Squad` interface. @public */
// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: SE36 namespace class merges with the `Squad` instance interface (ADR 0015) — intentional; `create()` returns the interface type, `new` is blocked by the private ctor.
export class Squad {
  private constructor() {}
  static create(options: SquadOptions): Squad {
    return createSquad(options);
  }
}
