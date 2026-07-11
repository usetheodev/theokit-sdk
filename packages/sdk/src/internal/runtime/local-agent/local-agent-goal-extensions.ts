/**
 * SE33 (ADR 0012) — the durable-objective agent methods, extracted from
 * `local-agent.ts` (G8 budget) mirroring `local-agent-runtime-extensions.ts`.
 * Each resolves the agent's storage handle to a `ConversationStorageAdapter` and
 * delegates to the pure `objective-store`. All no-op when the run is not
 * memory-backed (an adapter that omits the optional objective methods).
 *
 * @internal
 */

import { ConfigurationError } from "../../../errors.js";
import type { ConversationStorageAdapter } from "../../../types/conversation-storage.js";
import type { GoalOptions, GoalResult } from "../../../types/goal-events.js";
import type {
  AgentGoalConfig,
  DurableGoalOptions,
  ObjectiveRecord,
  ObjectiveStatus,
} from "../../../types/objective.js";
import { FileSystemConversationStorage } from "../../persistence/conversation-storage-fs.js";
import {
  clearObjective,
  getObjective,
  setObjective,
  updateObjectiveOptions,
  writeObjectiveProgress,
} from "../objective/objective-store.js";

/** Built-in durable run budget when no per-objective / standing config sets one (ADR D3). */
const DEFAULT_MAX_RUNS = 20;

/**
 * Resolve the agent's storage handle to an adapter. For the STRING branch (a
 * cwd), a fresh {@link FileSystemConversationStorage} is returned — the file on
 * disk IS the state, so no shared instance is needed (a fresh reader/writer sees
 * the same files). For an adapter branch, the SAME shared adapter is returned
 * (its in-memory / connection state is the durability boundary).
 */
function resolveAdapter(handle: ConversationStorageAdapter | string): ConversationStorageAdapter {
  return typeof handle === "string" ? new FileSystemConversationStorage({ root: handle }) : handle;
}

/** Fail-fast validation of caller-supplied durable options (LOW-3). */
function assertValidGoalOptions(options: DurableGoalOptions): void {
  if (
    options.maxRuns !== undefined &&
    (!Number.isInteger(options.maxRuns) || options.maxRuns <= 0)
  ) {
    throw new ConfigurationError(`maxRuns must be a positive integer, got ${options.maxRuns}`, {
      code: "invalid_objective_max_runs",
    });
  }
}

export async function localAgentSetObjective(
  handle: ConversationStorageAdapter | string,
  objective: string,
  opts: { threadId: string } & DurableGoalOptions,
): Promise<void> {
  const { threadId, ...options } = opts;
  assertValidGoalOptions(options);
  await setObjective(
    resolveAdapter(handle),
    threadId,
    objective,
    Object.keys(options).length > 0 ? options : undefined,
  );
}

export async function localAgentGetObjective(
  handle: ConversationStorageAdapter | string,
  opts: { threadId: string },
): Promise<ObjectiveRecord | undefined> {
  return getObjective(resolveAdapter(handle), opts.threadId);
}

export async function localAgentUpdateObjectiveOptions(
  handle: ConversationStorageAdapter | string,
  opts: { threadId: string } & DurableGoalOptions,
): Promise<void> {
  const { threadId, ...patch } = opts;
  assertValidGoalOptions(patch);
  await updateObjectiveOptions(resolveAdapter(handle), threadId, patch);
}

export async function localAgentClearObjective(
  handle: ConversationStorageAdapter | string,
  opts: { threadId: string },
): Promise<void> {
  await clearObjective(resolveAdapter(handle), opts.threadId);
}

/**
 * Outcome of resolving a `runUntil()` call with NO explicit goal against the
 * durable thread-scoped objective (ADR D3/D4):
 * - `run`   — an objective is set AND a judge resolves; carries the effective run.
 * - `inert` — an objective is set but NO explicit judge resolves; the standing
 *             objective is inert (no scoring, no budget consumed) — the judge is
 *             the activation switch (ADR D3, mirroring Mastra).
 * - `exhausted` — an objective is set + activated but its durable budget
 *             (`maxRuns`) is spent; the loop is NOT entered (a 0-turn run would
 *             burn a judge call for nothing). Raising `maxRuns` later resumes it.
 * - `none`  — no objective set for the thread.
 */
export type DurableRunResolution =
  | { kind: "run"; goal: string; options: GoalOptions }
  | { kind: "inert" }
  | { kind: "exhausted" }
  | { kind: "none" };

/**
 * Resolve a `runUntil()` call with NO explicit goal against the durable
 * thread-scoped objective (ADR D4).
 *
 * Precedence (ADR D3): per-call option → per-objective option → standing agent
 * `goal` config → built-in default. The per-call `maxTurns` (if any) is capped
 * by the durable budget remaining (`maxRuns - runsUsed`), so the objective can
 * never overrun its total run budget across resumes. Activation requires an
 * EXPLICIT judge (per-objective `judgeModel` or standing `goal.judgeModel`); the
 * built-in default judge does NOT auto-activate a standing objective.
 */
export async function resolveDurableRun(
  handle: ConversationStorageAdapter | string,
  goalConfig: AgentGoalConfig | undefined,
  threadId: string,
  callerOptions: GoalOptions | undefined,
): Promise<DurableRunResolution> {
  const record = await getObjective(resolveAdapter(handle), threadId);
  if (record === undefined) return { kind: "none" };

  // The judge is the activation switch (ADR D3). A per-call judge override,
  // a per-objective judge, or a standing-config judge activates it; the
  // built-in default alone does not.
  const judgeModel =
    callerOptions?.judgeModel ?? record.options?.judgeModel ?? goalConfig?.judgeModel;
  if (judgeModel === undefined) return { kind: "inert" };

  const totalBudget = record.options?.maxRuns ?? goalConfig?.maxRuns ?? DEFAULT_MAX_RUNS;
  const remaining = Math.max(0, totalBudget - record.runsUsed);
  // MEDIUM-3 — a spent budget must NOT enter the loop with maxTurns:0 (that would
  // burn a judge call and yield no useful events). Surface it as `exhausted`.
  if (remaining === 0) return { kind: "exhausted" };
  const perCall = callerOptions?.maxTurns;
  const maxTurns = perCall !== undefined ? Math.min(perCall, remaining) : remaining;

  return {
    kind: "run",
    goal: record.objective,
    options: { ...callerOptions, maxTurns, judgeModel },
  };
}

/**
 * Write a completed `runUntil()` pass back into the durable objective (ADR D4):
 * accumulate `runsUsed`, and map the loop result to a durable status —
 * `completed → done`, `paused → paused`, `failed (budget exhausted) → active`
 * so a later `runUntil()` resumes the same objective. No-op when the objective
 * was cleared mid-run.
 */
export async function persistDurableProgress(
  handle: ConversationStorageAdapter | string,
  threadId: string,
  result: GoalResult,
): Promise<void> {
  const adapter = resolveAdapter(handle);
  const record = await getObjective(adapter, threadId);
  if (record === undefined) return;
  const status: ObjectiveStatus =
    result.status === "completed" ? "done" : result.status === "paused" ? "paused" : "active";
  await writeObjectiveProgress(adapter, threadId, {
    runsUsed: record.runsUsed + result.turnsUsed,
    status,
  });
}
