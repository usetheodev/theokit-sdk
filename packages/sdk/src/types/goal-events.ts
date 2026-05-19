/**
 * Public event types emitted by {@link SDKAgent.runUntil} (ADRs D115-D117).
 *
 * Discriminated union by `type` field so consumers can `switch (event.type)`
 * with full TypeScript exhaustiveness. Mirrors the
 * {@link import("../stream-object.js").StreamObjectEvent} pattern (ADR D39).
 *
 * @public
 */

/**
 * Single event emitted while iterating a goal-driven loop. Five variants:
 *
 * - `turn_start` — the agent is about to invoke `send()`. Emitted once
 *   per turn.
 * - `agent_response` — the agent's `send()` resolved; carries the text
 *   reply.
 * - `judge_verdict` — the auxiliary judge model evaluated the response.
 *   `parseFailed: true` indicates the judge returned a malformed reply
 *   (fail-safe verdict = `continue`, see ADR D121).
 * - `continuation` — the goal is not yet satisfied; carries the prompt
 *   that will be sent at the start of the next turn.
 * - `status_change` — transition of the overall goal state. Always
 *   emitted once at start (`active`) and once at end
 *   (`completed | failed | paused`).
 *
 * @public
 */
export type GoalEvent =
  | { type: "turn_start"; turn: number; goal: string }
  | { type: "agent_response"; turn: number; content: string }
  | {
      type: "judge_verdict";
      turn: number;
      verdict: "done" | "continue" | "skipped";
      reason: string;
      parseFailed: boolean;
    }
  | { type: "continuation"; turn: number; prompt: string }
  | {
      type: "status_change";
      status: "active" | "paused" | "completed" | "failed";
      reason: string;
    };

/**
 * Return value of the `runUntil` async generator. Consumer reads via
 * `const { value } = await gen.next()` (when `done: true`).
 *
 * @public
 */
export interface GoalResult {
  status: "completed" | "failed" | "paused";
  turnsUsed: number;
  finalResponse: string | undefined;
}

/**
 * Return type of {@link import("../internal/runtime/local-agent.js").LocalAgent.runUntil}.
 * Extracted so the LocalAgent method signature stays a single line (G8 LoC budget).
 *
 * @public
 */
export type RunUntilIterator = AsyncGenerator<GoalEvent, GoalResult, void>;

/**
 * Per-call configuration for `Agent.runUntil`.
 *
 * @public
 */
export interface GoalOptions {
  /** Hard cap on iterations. Default `20`. */
  maxTurns?: number;
  /** Bail after N consecutive judge parse failures. Default `3` (ADR D121). */
  maxConsecutiveJudgeFailures?: number;
  /** Judge model identifier. Default `"openai/gpt-4o-mini"` (ADR D119). */
  judgeModel?: string;
  /** Override env for the judge auxiliary agent. Default `OPENROUTER_API_KEY` (EC-A). */
  judgeApiKey?: string;
  /** Optional subgoals fed to the judge prompt. */
  subgoals?: string[];
  /**
   * Cancel mid-loop via `AbortController.signal`. The generator yields
   * a `status_change: paused` event and returns at the next turn
   * boundary (ADR D117).
   */
  signal?: AbortSignal;
}
