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

import type { AgentOptions, MemorySettings, SDKAgent } from "../../../types/agent.js";
import type { ConversationStorageAdapter } from "../../../types/conversation-storage.js";
import type { GoalEvent, GoalOptions, GoalResult } from "../../../types/goal-events.js";
import type { AgentGoalConfig } from "../../../types/objective.js";
import type { RunToCompletionOptions, RunToCompletionResult } from "../../../types/run.js";
import type { JudgeContext, JudgeOptions } from "../../judge/judge-call.js";
import type { ForkOptions, ForkResult } from "../lifecycle/fork-agent.js";
import type { RunUntilDeps } from "../lifecycle/run-until.js";
import {
  appendMemoryFact,
  extractMemoryFact,
  isMemoryWritePrompt,
} from "../memory/memory-store.js";
import { safeCall } from "../system-prompt/safe-call.js";

/** Human-readable pause reason for a non-`run` durable resolution (ADR D4). */
function pausedReason(kind: "none" | "inert" | "exhausted", threadId: string): string {
  switch (kind) {
    case "none":
      return `no durable objective set for thread "${threadId}" — call setObjective() first`;
    case "inert":
      return `durable objective for thread "${threadId}" is inert — no judge resolved (set a judge to activate)`;
    case "exhausted":
      return `durable objective for thread "${threadId}" exhausted its run budget — raise maxRuns to resume`;
  }
}

/**
 * Drive {@link runUntilImpl} with the registered `Agent.create` so
 * `LocalAgent.runUntil` returns the canonical
 * `AsyncGenerator<GoalEvent, GoalResult, void>` shape (ADR D116).
 *
 * @internal
 */
export function localAgentRunUntil(
  agent: SDKAgent,
  goal: string | undefined,
  options: GoalOptions | undefined,
  durable?: {
    handle: ConversationStorageAdapter | string;
    goalConfig: AgentGoalConfig | undefined;
  },
): AsyncGenerator<GoalEvent, GoalResult, void> {
  async function* wrap(): AsyncGenerator<GoalEvent, GoalResult, void> {
    const { runUntilImpl } = await import("../lifecycle/run-until.js");
    const buildDeps = async (): Promise<RunUntilDeps> => {
      const { judgeCallImpl } = await import("../../judge/judge-call.js");
      const { getAgentFacade } = await import("../registry/agent-factory-registry.js");
      const create = getAgentFacade().create;
      return {
        judge: (ctx: JudgeContext, opts?: JudgeOptions) => judgeCallImpl(ctx, opts, { create }),
      };
    };

    // Ephemeral path — explicit goal; no durable objective read/write (ADR D4).
    if (goal !== undefined) {
      return yield* runUntilImpl(agent, goal, options, await buildDeps());
    }

    // Durable path — resolve the goal from the thread-scoped objective.
    const threadId = options?.threadId;
    if (durable === undefined || threadId === undefined) {
      const reason =
        "runUntil() called with no goal and no threadId — nothing to resolve a durable objective from";
      yield { type: "status_change", status: "paused", reason };
      return { status: "paused", turnsUsed: 0, finalResponse: undefined };
    }
    const { resolveDurableRun, persistDurableProgress } = await import(
      "./local-agent-goal-extensions.js"
    );
    const resolved = await resolveDurableRun(durable.handle, durable.goalConfig, threadId, options);
    if (resolved.kind !== "run") {
      yield {
        type: "status_change",
        status: "paused",
        reason: pausedReason(resolved.kind, threadId),
      };
      return { status: "paused", turnsUsed: 0, finalResponse: undefined };
    }
    const result = yield* runUntilImpl(agent, resolved.goal, resolved.options, await buildDeps());
    await persistDurableProgress(durable.handle, threadId, result);
    return result;
  }
  return wrap();
}

/**
 * Drive {@link runToCompletionImpl} bound to this agent's stateful `send`
 * (M1 Phase 3). The agent's session preserves conversation history, so the
 * driver only re-sends a short continuation prompt after each truncated round.
 *
 * @internal
 */
export function localAgentRunToCompletion(
  agent: SDKAgent,
  message: string,
  options: RunToCompletionOptions | undefined,
): Promise<RunToCompletionResult> {
  async function run(): Promise<RunToCompletionResult> {
    const { runToCompletionImpl } = await import("../lifecycle/run-to-completion.js");
    return runToCompletionImpl({ send: (m, o) => agent.send(m, o) }, message, options);
  }
  return run();
}

/**
 * Drive the STREAMING continuation twin (V3-4) bound to this agent's stateful
 * `send` — yields each round's `SDKMessage`s live, reusing the M1 terminal policy.
 *
 * @internal
 */
export async function* localAgentStreamToCompletion(
  agent: SDKAgent,
  message: string,
  options: RunToCompletionOptions | undefined,
): AsyncGenerator<
  import("../../../types/messages.js").SDKMessage,
  import("../../../types/run.js").StreamToCompletionResult
> {
  const { streamToCompletionImpl } = await import("../lifecycle/stream-to-completion.js");
  return yield* streamToCompletionImpl({ send: (m, o) => agent.send(m, o) }, message, options);
}

/**
 * Spawn a forked auxiliary agent (ADR D110). Reads `Agent.create` from
 * the DI registry.
 *
 * @internal
 */
export async function localAgentFork(
  parent: { agentId: string; options: AgentOptions; personalitySlugSnapshot: string | undefined },
  options: ForkOptions,
): Promise<ForkResult> {
  const { forkAgentImpl } = await import("../lifecycle/fork-agent.js");
  const { getAgentFacade } = await import("../registry/agent-factory-registry.js");
  const { withPersonalityContext } = await import("../../personality/context.js");
  const create = getAgentFacade().create;
  // ADR D168 + EC-A — capture the slug ONCE at fork-construction time.
  // Subsequent parent `usePersonality` calls do NOT mutate this snapshot.
  return withPersonalityContext({ slug: parent.personalitySlugSnapshot, isFork: true }, () =>
    forkAgentImpl(parent, options, { create }),
  );
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
