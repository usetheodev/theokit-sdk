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
import type { SDKAgent } from "./types/agent.js";
import type { StepResult } from "./types/workflow.js";
import { agentStep, Workflow } from "./workflow.js";

/**
 * Options for {@link createSquad}.
 *
 * @public
 */
export interface SquadOptions {
  /** Agents run in array order (sequential pipeline). Must be non-empty. */
  agents: ReadonlyArray<SDKAgent>;
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
export function createSquad(options: SquadOptions): Squad {
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
      // Compose Workflow + agentStep — identity threading: each agent's prompt
      // is the previous agent's output (the run input for the first agent).
      let builder = Workflow.create({ name: options.name ?? "squad" });
      for (let i = 0; i < agents.length; i++) {
        const agent = agents[i];
        if (agent === undefined) continue;
        // SE3 — the first agent receives the human input (no peer origin); every
        // subsequent agent receives its predecessor's output, so its turn carries
        // `{ kind: "peer", from: "agent-<i-1>" }`. Metadata-only — threading unchanged.
        const opts =
          i > 0 ? { origin: { kind: "peer" as const, from: `agent-${i - 1}` } } : undefined;
        builder = builder.then(agentStep(`agent-${i}`, agent, (prev) => String(prev), opts));
      }
      const run = await builder.commit().run(input);
      return { result: run.output, status: run.status, steps: run.stepResults };
    },
  };
}
