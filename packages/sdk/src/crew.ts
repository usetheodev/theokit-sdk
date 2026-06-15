/**
 * `createCrew` — sequential multi-agent team (cross-validation Gap 1, narrowed).
 *
 * A THIN convenience that COMPOSES `Workflow` + `agentStep` — it adds NO new
 * orchestration logic. Agents run in order; each agent's output is threaded
 * into the next agent's prompt. For branching/parallel/foreach teams use
 * `Workflow` directly; for manager→worker delegation use subagents or
 * `@theokit/sdk-handoff` (those already cover a peer project's "hierarchical" process).
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
 * Options for {@link createCrew}.
 *
 * @public
 */
export interface CrewOptions {
  /** Agents run in array order (sequential pipeline). Must be non-empty. */
  agents: ReadonlyArray<SDKAgent>;
  /**
   * Orchestration process. Only `"sequential"` is supported by `createCrew`
   * (the default). `"hierarchical"` is accepted by the type but rejected at
   * runtime with guidance — use subagents or `@theokit/sdk-handoff` for
   * manager→worker delegation (those already cover it).
   */
  process?: "sequential" | "hierarchical";
  /** Optional crew name (surfaced on the underlying workflow). Default `"crew"`. */
  name?: string;
}

/**
 * Result of a {@link Crew.run}. `result` is the final (last agent's) output;
 * `steps` is the per-agent trace from the underlying workflow run.
 *
 * @public
 */
export interface CrewRun {
  readonly result: unknown;
  readonly status: "running" | "completed" | "failed" | "suspended" | "cancelled";
  readonly steps: ReadonlyArray<StepResult>;
}

/**
 * A sequential agent team produced by {@link createCrew}.
 *
 * @public
 */
export interface Crew {
  /** Run the team over `input`, threading each agent's output to the next. */
  run(input: unknown): Promise<CrewRun>;
}

/**
 * Build a sequential agent team. The returned {@link Crew} composes a
 * `Workflow` of `agentStep`s under the hood — all orchestration is delegated
 * to the workflow engine.
 *
 * @public
 */
export function createCrew(options: CrewOptions): Crew {
  const { agents } = options;
  if (!Array.isArray(agents) || agents.length === 0) {
    throw new ConfigurationError("createCrew requires a non-empty `agents` array", {
      code: "invalid_crew",
    });
  }
  if (options.process !== undefined && options.process !== "sequential") {
    throw new ConfigurationError(
      `createCrew only supports process "sequential"; for manager→worker delegation use subagents or @theokit/sdk-handoff`,
      { code: "crew_process_unsupported" },
    );
  }

  return {
    run: async (input: unknown): Promise<CrewRun> => {
      // Compose Workflow + agentStep — identity threading: each agent's prompt
      // is the previous agent's output (the run input for the first agent).
      let builder = Workflow.create({ name: options.name ?? "crew" });
      for (let i = 0; i < agents.length; i++) {
        const agent = agents[i];
        if (agent === undefined) continue;
        builder = builder.then(agentStep(`agent-${i}`, agent, (prev) => String(prev)));
      }
      const run = await builder.commit().run(input);
      return { result: run.output, status: run.status, steps: run.stepResults };
    },
  };
}
