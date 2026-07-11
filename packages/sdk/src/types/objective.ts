/**
 * SE33 — the durable, thread-scoped objective (Mastra Goals parity, durable half).
 *
 * The SDK's `runUntil` goal loop (ADRs D115-D121) is per-call/transient. SE33
 * persists an objective in conversation storage (via the optional
 * `getObjectiveRecord`/`setObjectiveRecord` adapter methods) so it survives
 * reloads, is managed via `Agent` methods, and is read by `runUntil` when no
 * explicit goal is passed. See ADR 0012.
 *
 * @public
 */

/** Lifecycle status of a durable objective (ADR 0012 D2). */
export type ObjectiveStatus = "active" | "done" | "paused";

/**
 * The per-objective override subset of goal options. Precedence (ADR 0012 D3):
 * these `record.options` → the agent's standing `goal` config → built-in default.
 * The `judgeModel` is the activation switch — with no judge resolved, the
 * standing objective is inert (no scoring, no budget consumed).
 */
export interface DurableGoalOptions {
  /** Max judge-gated turns before the loop stops (default 20 — the `runUntil` default). */
  readonly maxRuns?: number;
  /** Judge model identifier (e.g. `"openai/gpt-4o-mini"`). Absent ⇒ inherit from agent `goal` config. */
  readonly judgeModel?: string;
  /** Optional extra judge instruction appended to the default judge prompt. */
  readonly prompt?: string;
}

/**
 * A persisted objective record. Stored under the caller's `threadId` (the
 * conversation key). `_schemaVersion` mirrors {@link import("./workflow.js").WorkflowSnapshot}
 * for future migration (ADR 0012 D2).
 */
export interface ObjectiveRecord {
  readonly _schemaVersion: 1;
  readonly objective: string;
  readonly options?: DurableGoalOptions;
  readonly status: ObjectiveStatus;
  readonly runsUsed: number;
}

/** The standing `goal` config on an agent (ADR 0012 D3). Read when a durable objective is set. */
export interface AgentGoalConfig {
  readonly judgeModel?: string;
  readonly maxRuns?: number;
  readonly prompt?: string;
}
