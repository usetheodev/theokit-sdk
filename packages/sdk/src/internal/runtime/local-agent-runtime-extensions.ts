/**
 * Background-work runtime extensions for {@link LocalAgent} (T4.2 + T4.3).
 *
 * Extracted from `local-agent.ts` to keep that file under the 400-LoC
 * guard (G8). The two helpers below implement
 * `LocalAgent.runUntil(goal, options)` and `LocalAgent.fork(options)`
 * by lazy-importing the implementation modules and resolving
 * `Agent.create` through the DI registry (see
 * `agent-factory-registry.ts` for the cycle-avoidance rationale).
 *
 * @internal
 */

import type { AgentOptions, MemorySettings, SDKAgent } from "../../types/agent.js";
import type { GoalEvent, GoalOptions, GoalResult } from "../../types/goal-events.js";
import type { JudgeContext, JudgeOptions } from "../judge/judge-call.js";
import type { ForkOptions, ForkResult } from "./fork-agent.js";
import { appendMemoryFact, extractMemoryFact, isMemoryWritePrompt } from "./memory-store.js";
import { safeCall } from "./system-prompt/safe-call.js";

/**
 * Drive {@link runUntilImpl} with the registered `Agent.create` so
 * `LocalAgent.runUntil` returns the canonical
 * `AsyncGenerator<GoalEvent, GoalResult, void>` shape (ADR D116).
 *
 * @internal
 */
export function localAgentRunUntil(
  agent: SDKAgent,
  goal: string,
  options: GoalOptions | undefined,
): AsyncGenerator<GoalEvent, GoalResult, void> {
  async function* wrap(): AsyncGenerator<GoalEvent, GoalResult, void> {
    const { runUntilImpl } = await import("./run-until.js");
    const { judgeCallImpl } = await import("../judge/judge-call.js");
    const { getAgentCreate } = await import("./agent-factory-registry.js");
    const create = getAgentCreate();
    const deps = {
      judge: async (ctx: JudgeContext, opts?: JudgeOptions) => judgeCallImpl(ctx, opts, { create }),
    };
    return yield* runUntilImpl(agent, goal, options, deps);
  }
  return wrap();
}

/**
 * Spawn a forked auxiliary agent (ADR D110). Reads `Agent.create` from
 * the DI registry.
 *
 * @internal
 */
export async function localAgentFork(
  parent: { agentId: string; options: AgentOptions },
  options: ForkOptions,
): Promise<ForkResult> {
  const { forkAgentImpl } = await import("./fork-agent.js");
  const { getAgentCreate } = await import("./agent-factory-registry.js");
  const create = getAgentCreate();
  return forkAgentImpl(parent, options, { create });
}

/**
 * Extract a memory fact from a "Remember:" user prompt and persist it
 * via `appendMemoryFact`. No-op when memory is disabled, the prompt is
 * not a write directive, or the extracted fact is empty (EC-3/EC-4).
 *
 * Moved here from `LocalAgent` to keep the class file under G8.
 *
 * @internal
 */
export async function persistMemoryFactIfWritePrompt(
  workspaceCwd: string,
  memoryConfig: MemorySettings | undefined,
  userText: string,
): Promise<void> {
  if (memoryConfig?.enabled !== true) return;
  if (!isMemoryWritePrompt(userText)) return;
  const fact = extractMemoryFact(userText);
  if (fact.length === 0) return;
  await safeCall(
    () => appendMemoryFact(workspaceCwd, memoryConfig, { text: fact }),
    undefined,
    "memory write",
  );
}
