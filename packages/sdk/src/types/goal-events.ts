/**
 * Owner: `internal/judge/` (3 of 8 importers). Derived from the import graph, not declared —
 * `tests/lint/types-name-their-owner.test.ts` re-derives it.
 *
 * M80 — the terminal verdicts a judge can return.
 *
 * `"blocked"` was added here in this milestone. `GoalResult.status` already carried it, but the
 * judge had no way to EMIT it: its vocabulary was `done | continue | skipped`, so facing a real
 * blocker it could only say `continue` — and the loop repeated the same turn until it blew the
 * budget, reporting `failed` on a limit rather than `blocked` on impossibility. Two different causes
 * with the same visible outcome.
 *
 * @public
 */
export type Verdict = "done" | "continue" | "skipped" | "blocked";

/**
 * M80 — the result of a judge call, now public.
 *
 * It was `internal/`, so a consumer wanting to type the return — to react to `blocked` without a
 * magic string — had to redeclare the shape. It is the same duplication M78 closed for the error
 * hierarchy: without a public surface, reimplementing is the only legal way out for anyone behind
 * the layer boundary.
 *
 * @public
 */
export interface JudgeResult {
  verdict: Verdict;
  reason: string;
  /**
   * `true` when the text did not start with one of the canonical prefixes. The verdict becomes
   * `"continue"` (fail-safe) so the loop does not stop too early; the caller counts consecutive
   * failures and gives up via `maxConsecutiveJudgeFailures`.
   */
  parseFailed: boolean;
}

/**
 * Single event emitted while iterating a goal-driven loop — the public event type of
 * {@link SDKAgent.runUntil} (ADRs D115-D117). Discriminated union by the `type` field so
 * consumers can `switch (event.type)` with full TypeScript exhaustiveness; mirrors the
 * {@link import("../stream-object.js").StreamObjectEvent} pattern (ADR D39).
 *
 * Five variants:
 *
 * - `turn_start` — the agent is about to invoke `send()`. Emitted once
 *   per turn.
 * - `agent_response` — the agent's `send()` resolved; carries the text
 *   reply.
 * - `judge_verdict` — the auxiliary judge model evaluated the response.
 *   `parseFailed: true` indicates the judge returned a malformed reply
 *   (fail-safe verdict = `continue`, see ADR D121).
 * - `continuation` — the judge ruled `continue`; carries the prompt that
 *   was sent on THIS turn (i.e., the input that produced the agent
 *   response just yielded). Useful for consumers who want to audit the
 *   exact continuation message that drove each iteration. The prompt
 *   for the NEXT turn is composed lazily at the start of that turn
 *   from the latest `agent_response.content`.
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
      /** M80 — `"blocked"` was added: the judge can declare impossibility, not just "continue". */
      verdict: "done" | "continue" | "skipped" | "blocked";
      reason: string;
      parseFailed: boolean;
    }
  | { type: "continuation"; turn: number; prompt: string }
  | {
      type: "status_change";
      // M55 — states faithful to Codex (ext/goal tool.rs:467-476). `budget_limited` = crossed the
      // tokenBudget; `blocked` is reserved for the >=3-turn impasse (v1 uses failed). Additive —
      // exhaustive consumers gain new cases.
      status: "active" | "paused" | "completed" | "failed" | "budget_limited" | "blocked";
      reason: string;
    };

/**
 * Return value of the `runUntil` async generator. Consumer reads via
 * `const { value } = await gen.next()` (when `done: true`).
 *
 * @public
 */
export interface GoalResult {
  status: "completed" | "failed" | "paused" | "budget_limited" | "blocked";
  turnsUsed: number;
  /** M55 — tokens summed across the loop (0 when `usage` was absent — fail-open). */
  tokensUsed: number;
  finalResponse: string | undefined;
}

/**
 * Return type of {@link import("../internal/local-agent/local-agent.js").LocalAgent.runUntil}.
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
  /** Hard cap on iterations (safety net against runaway). Default `20`. */
  maxTurns?: number;
  /**
   * M55 — token budget (Codex ext/goal parity, tool.rs:454-465). Sums `run.wait().usage.totalTokens`
   * per turn; on crossing it, the loop stops with status `budget_limited`. Omitted => unlimited (only
   * maxTurns). A missing `usage` never blows the budget (fail-open).
   */
  tokenBudget?: number;
  /** Bail after N consecutive judge parse failures. Default `3` (ADR D121). */
  maxConsecutiveJudgeFailures?: number;
  /** Judge model identifier. Default `"openai/gpt-4o-mini"` (ADR D119). */
  judgeModel?: string;
  /** Override env for the judge auxiliary agent. Default `OPENROUTER_API_KEY` (EC-A). */
  judgeApiKey?: string;
  /**
   * M80 — the model of the DRIVEN agent, the basis for deriving the judge when `judgeModel` is
   * omitted.
   *
   * It exists because the fixed default (`openai/gpt-4o-mini`) only resolves on OpenRouter: an
   * Anthropic key gives 404, an OAuth bearer gives 401, and the goal burned 3 turns before failing
   * with a misleading reason. A judge running on the chat's own model works wherever chat works.
   */
  agentModel?: string;
  /** Optional subgoals fed to the judge prompt. */
  subgoals?: string[];
  /**
   * Cancel mid-loop via `AbortController.signal`. The generator yields
   * a `status_change: paused` event and returns at the next turn
   * boundary (ADR D117).
   */
  signal?: AbortSignal;
}
