/**
 * `streamToCompletion` — the STREAMING continuation driver (V3-4, plan
 * v34-stream-to-completion). The streaming twin of `runToCompletion`: it yields
 * each round's `SDKMessage`s LIVE (the V3-4 (a) gap a UI needs) while reusing the
 * SAME terminal policy as the M1 driver — `classifyRound` (done / step_limit /
 * no_progress) + bounded re-prompt + `addUsage` aggregation. It is NOT a second
 * policy (D1): the only difference from `runToCompletion` is surfacing events over
 * `Run.stream()` instead of returning only the final `Run.wait()` result.
 *
 * Stateful, like `runToCompletion` (the agent's session preserves history via the
 * native transcript; the continuation prompt is short). A stateless consumer
 * reconstructs history from the on-disk native transcript into a fresh agent.
 *
 * The `StreamToCompletionResult` is the generator's RETURN value, read via a
 * manual `gen.next()` loop (`while (!res.done) res = await gen.next()` → `res.value`).
 * A plain `for await...of` consumes the yielded messages but discards the return
 * value (EC-1).
 *
 * @internal
 */

import type { SDKMessage } from "../../../types/messages.js";
import type {
  RunResult,
  RunToCompletionOptions,
  SendOptions,
  StreamToCompletionResult,
} from "../../../types/run.js";

import {
  addUsage,
  buildResult,
  classifyRound,
  continuationTail,
  isEmptyRound,
  promptForRound,
  type RoundState,
  resolveContinuation,
} from "./run-to-completion.js";

/** One streamed round handle: drain `stream()` (live events) then `wait()` (terminal result). */
interface StreamRun {
  stream(): AsyncGenerator<SDKMessage, void>;
  wait(): Promise<RunResult>;
}

/** Minimal agent port the streaming driver needs — the instance `.send()` surface. */
export interface StreamToCompletionAgent {
  send(message: string, options?: SendOptions): Promise<StreamRun>;
}

/** A round either reaches a terminal, or yields the state to carry forward. */
type RoundDecision = { terminal: StreamToCompletionResult } | { next: RoundState };

/**
 * Fold this round's usage, classify it (reusing the M1 policy), and decide
 * whether to finish or carry state into the next round. Splits the decision out
 * of the generator body to keep its cognitive complexity in budget.
 */
function decideRound(
  result: RunResult,
  round: number,
  maxRounds: number,
  state: RoundState,
): RoundDecision {
  const usage = addUsage(state.usage, result.usage);
  const decision = classifyRound(result, round, maxRounds, state.emptyStreak);
  if (decision !== "continue") return { terminal: buildResult(decision, round, result, usage) };
  const emptyStreak = isEmptyRound(result) ? state.emptyStreak + 1 : 0;
  return { next: { usage, emptyStreak } };
}

/**
 * Drive `agent.send()` until a terminal, YIELDING each round's `SDKMessage`s
 * live. Returns the {@link StreamToCompletionResult} (the generator return value).
 *
 * @internal
 */
export async function* streamToCompletionImpl(
  agent: StreamToCompletionAgent,
  message: string,
  options?: RunToCompletionOptions,
): AsyncGenerator<SDKMessage, StreamToCompletionResult> {
  const cfg = resolveContinuation(options);
  let state = cfg.state;

  for (let round = 0; ; round += 1) {
    const prompt = promptForRound(round, message, cfg.continuationPrompt);
    // SE3 — a continuation round is a driver-initiated turn; stamp its provenance.
    const roundOptions =
      round === 0
        ? cfg.sendOptions
        : { ...(cfg.sendOptions ?? {}), origin: { kind: "auto-continuation" as const } };
    const run = await agent.send(prompt, roundOptions);

    // (a) STREAMING: delegate the round's events live, before classifying.
    yield* run.stream();
    const result = await run.wait();

    const decision = decideRound(result, round, cfg.maxRounds, state);
    if ("terminal" in decision) return decision.terminal;

    state = decision.next;
    const aborted = await continuationTail(round, result, state.usage, cfg.onTruncated, cfg.signal);
    if (aborted !== undefined) return aborted;
  }
}
