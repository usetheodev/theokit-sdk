/**
 * M56 (agent-builder goal transparency) — PUBLIC goal-loop driver for CUSTOM agent surfaces.
 *
 * `LocalAgent.runUntil` binds the goal loop to a registered local agent. Surfaces that route turns
 * through their OWN transport (e.g. a TUI store facade, so every goal turn renders in the same
 * timeline as a manual turn) need the SAME loop over a minimal `send → wait` shape. This export
 * gives them exactly that: the canonical `runUntilImpl` (judge + continuation + token budget +
 * Codex states) with the default judge wired from the DI registry.
 *
 * @public
 */

import type { JudgeContext, JudgeOptions } from "./internal/judge/judge-call.js";
import type { RunUntilDeps } from "./internal/runtime/lifecycle/run-until.js";
import type { SDKAgent } from "./types/agent.js";
import type { GoalEvent, GoalOptions, GoalResult } from "./types/goal-events.js";

/** The minimal surface the goal loop drives — anything that can send a prompt and wait for it. */
export interface GoalLoopAgent {
  send(prompt: string): Promise<{
    wait(): Promise<{ result?: string; usage?: { totalTokens?: number } }>;
  }>;
}

/**
 * Run the goal-driven loop (`send → judge → continuation`) over ANY `send → wait` surface.
 * Identical semantics to `Agent.runUntil` (ADRs D115-D121 + M55 token budget / states).
 * `depsOverride` is a test seam for injecting a fake judge.
 */
export function runGoalLoop(
  agent: GoalLoopAgent,
  goal: string,
  options?: GoalOptions,
  depsOverride?: RunUntilDeps,
): AsyncGenerator<GoalEvent, GoalResult, void> {
  async function* wrap(): AsyncGenerator<GoalEvent, GoalResult, void> {
    const { runUntilImpl } = await import("./internal/runtime/lifecycle/run-until.js");
    const deps: RunUntilDeps =
      depsOverride ??
      (await (async () => {
        const { judgeCallImpl } = await import("./internal/judge/judge-call.js");
        const { getAgentFacade } = await import(
          "./internal/runtime/registry/agent-factory-registry.js"
        );
        const create = getAgentFacade().create;
        return {
          judge: (ctx: JudgeContext, opts?: JudgeOptions) => judgeCallImpl(ctx, opts, { create }),
        };
      })());
    // runUntilImpl only touches `agent.send(...)` → `run.wait()` — the SDKAgent cast is safe for
    // any GoalLoopAgent (structural subset).
    return yield* runUntilImpl(agent as unknown as SDKAgent, goal, options, deps);
  }
  return wrap();
}
