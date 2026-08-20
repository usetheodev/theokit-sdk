/**
 * `runToCompletion` continuation driver (M1 Phase 3 — plan m1-run-to-completion).
 *
 * Drives repeated `send()`s on a STATEFUL agent until a genuine terminal,
 * consuming the `RunResult.stoppedAtIterationLimit` signal shipped in 2.2.0.
 * The agent's session preserves conversation history across sends, so after a
 * truncated round the driver only re-sends a short continuation prompt (it does
 * NOT reconstruct history). Mirrors the injectable shape of `run-until.ts` and
 * absorbs the outer-loop policy hand-rolled in `theocode/server/lib/agent-loop.ts`.
 *
 * The core is decision-pure + injectable (`agent` is only the `.send` port) so
 * every terminal is unit-testable with a fake send — fixture mode never sets
 * `stoppedAtIterationLimit`, so injection is the only deterministic path.
 *
 * @internal
 */

import type {
  RunResult,
  RunToCompletionOptions,
  RunToCompletionResult,
  SendOptions,
} from "../../../types/run.js";
import type { TokenUsage } from "../../../types/usage.js";

/** Minimal agent port the driver needs — the instance `.send()` surface. */
export interface RunToCompletionAgent {
  send(message: string, options?: SendOptions): Promise<{ wait(): Promise<RunResult> }>;
}

/** @internal — shared with the streaming twin (`stream-to-completion.ts`, V3-4). */
export const DEFAULT_MAX_ROUNDS = 5;
/** @internal — shared with the streaming twin (`stream-to-completion.ts`, V3-4). */
export const DEFAULT_CONTINUATION_PROMPT =
  "Continue from where you left off and finish the task. If it is already complete, give the final answer.";

type RoundDecision = "done" | "continue" | "step_limit" | "no_progress";

/**
 * True when a round produced no observable output text.
 * @internal — shared with the streaming twin (`stream-to-completion.ts`, V3-4).
 */
export function isEmptyRound(result: RunResult): boolean {
  return (result.result ?? "").trim() === "";
}

/**
 * Pure decision: given a round's result + position + the running empty streak,
 * decide whether to finish (`done`), keep going (`continue`), or bail
 * (`step_limit` / `no_progress`).
 *
 * @internal
 */
export function classifyRound(
  result: RunResult,
  round: number,
  maxRounds: number,
  emptyStreak: number,
): RoundDecision {
  // Doom-loop stop is a genuine terminal (the model repeated identical tool calls) — classify it as
  // `no_progress` FIRST, before the iteration-limit check, so it is never mistaken for a truncation
  // to re-send (which would re-trigger the loop). Complements the empty-round `no_progress` below.
  if (result.stoppedByDoomLoop === true) return "no_progress";
  if (result.stoppedAtIterationLimit !== true) return "done";
  // Truncated at the iteration ceiling.
  if (isEmptyRound(result) && emptyStreak >= 1) return "no_progress";
  if (round >= maxRounds) return "step_limit";
  return "continue";
}

/**
 * Sum a round's usage into the running aggregate. `requests` is intentionally
 * dropped (concatenating per-run request breakdowns across continuation rounds
 * would falsely imply a single multi-call run). `totalTokens` is DERIVED
 * (`inputTokens + outputTokens`), never summed independently, to preserve the
 * EC-10 invariant (`usage.ts`) at this aggregation boundary even if a provider
 * folded extra buckets into a round's own `totalTokens`.
 * @internal — shared with the streaming twin (`stream-to-completion.ts`, V3-4).
 */
export function addUsage(
  acc: TokenUsage | undefined,
  u: TokenUsage | undefined,
): TokenUsage | undefined {
  if (u === undefined) return acc;
  const inputTokens = (acc?.inputTokens ?? 0) + u.inputTokens;
  const outputTokens = (acc?.outputTokens ?? 0) + u.outputTokens;
  const sumOpt = (a: number | undefined, b: number | undefined): number | undefined =>
    a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0);
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    cacheReadTokens: sumOpt(acc?.cacheReadTokens, u.cacheReadTokens),
    cacheWriteTokens: sumOpt(acc?.cacheWriteTokens, u.cacheWriteTokens),
    reasoningTokens: sumOpt(acc?.reasoningTokens, u.reasoningTokens),
  };
}

/**
 * Assemble the result object, omitting `usage` when no round reported any.
 * @internal — shared with the streaming twin (`stream-to-completion.ts`, V3-4).
 */
export function buildResult(
  terminal: RunToCompletionResult["terminal"],
  rounds: number,
  lastResult: RunResult,
  usage: TokenUsage | undefined,
): RunToCompletionResult {
  return { terminal, rounds, lastResult, ...(usage !== undefined ? { usage } : {}) };
}

/**
 * The shared between-rounds tail: fire `onTruncated`, then — re-reading `aborted`
 * (a getter that can flip between rounds) — return a `step_limit` result if the
 * signal aborted, else `undefined` to continue. Used by BOTH the stateful driver
 * and its streaming twin (V3-4), so the continuation-end policy has one home.
 * @internal
 */
export async function continuationTail(
  round: number,
  lastResult: RunResult,
  usage: TokenUsage | undefined,
  onTruncated: ((event: { round: number }) => void | Promise<void>) | undefined,
  signal: AbortSignal | undefined,
): Promise<RunToCompletionResult | undefined> {
  await onTruncated?.({ round });
  return signal?.aborted === true ? buildResult("step_limit", round, lastResult, usage) : undefined;
}

/**
 * Carried state between continuation rounds.
 * @internal — shared with the streaming twin (`stream-to-completion.ts`, V3-4).
 */
export interface RoundState {
  usage: TokenUsage | undefined;
  emptyStreak: number;
}

/** Resolved continuation config + fresh initial state — shared by both drivers. @internal */
export interface ResolvedContinuation {
  maxRounds: number;
  continuationPrompt: string;
  onTruncated: ((event: { round: number }) => void | Promise<void>) | undefined;
  signal: AbortSignal | undefined;
  sendOptions: SendOptions | undefined;
  state: RoundState;
}

/** Resolve options to the continuation config + a fresh state. One home for the defaults. @internal */
export function resolveContinuation(options?: RunToCompletionOptions): ResolvedContinuation {
  return {
    maxRounds: options?.maxRounds ?? DEFAULT_MAX_ROUNDS,
    continuationPrompt: options?.continuationPrompt ?? DEFAULT_CONTINUATION_PROMPT,
    onTruncated: options?.onTruncated,
    signal: options?.signal,
    sendOptions: options?.sendOptions,
    state: { usage: undefined, emptyStreak: 0 },
  };
}

/** The round's prompt: the task on round 0, the continuation prompt after. @internal */
export function promptForRound(round: number, message: string, continuationPrompt: string): string {
  return round === 0 ? message : continuationPrompt;
}

/** A round either reaches a terminal, or yields the state to carry into the next round. */
type RoundOutcome =
  | { terminal: RunToCompletionResult }
  | { next: RoundState; lastResult: RunResult };

/** Send one round, fold usage, classify. Splits the loop body out to cap complexity. */
async function stepRound(
  agent: RunToCompletionAgent,
  prompt: string,
  sendOptions: SendOptions | undefined,
  round: number,
  maxRounds: number,
  state: RoundState,
): Promise<RoundOutcome> {
  // SE3 — a continuation round (round > 0) is a driver-initiated turn; stamp its
  // provenance so a consumer can tell it apart from the caller's first send.
  const roundOptions: SendOptions | undefined =
    round === 0 ? sendOptions : { ...(sendOptions ?? {}), origin: { kind: "auto-continuation" } };
  const run = await agent.send(prompt, roundOptions);
  const result = await run.wait();
  const usage = addUsage(state.usage, result.usage);
  const decision = classifyRound(result, round, maxRounds, state.emptyStreak);
  if (decision !== "continue") return { terminal: buildResult(decision, round, result, usage) };
  const emptyStreak = isEmptyRound(result) ? state.emptyStreak + 1 : 0;
  return { next: { usage, emptyStreak }, lastResult: result };
}

/**
 * Drive `agent.send()` until a terminal. See {@link RunToCompletionOptions}.
 *
 * @internal
 */
export async function runToCompletionImpl(
  agent: RunToCompletionAgent,
  message: string,
  options?: RunToCompletionOptions,
): Promise<RunToCompletionResult> {
  const cfg = resolveContinuation(options);
  let state = cfg.state;

  for (let round = 0; ; round += 1) {
    const prompt = promptForRound(round, message, cfg.continuationPrompt);
    const outcome = await stepRound(agent, prompt, cfg.sendOptions, round, cfg.maxRounds, state);
    if ("terminal" in outcome) return outcome.terminal;

    // Truncated and below the round budget — re-send next iteration.
    state = outcome.next;
    const aborted = await continuationTail(
      round,
      outcome.lastResult,
      state.usage,
      cfg.onTruncated,
      cfg.signal,
    );
    if (aborted !== undefined) return aborted;
  }
}
