/**
 * UsageAccumulator — aggregate multi-step `LlmFinish` token counts
 * into a canonical `TokenUsage` (ADR D376, mirror a peer SDK
 * `Usage.add`).
 *
 * Each `add(step)` merges in a per-step finish; `toTokenUsage()`
 * produces the aggregated public shape with `requests[]` populated
 * when there were ≥2 steps.
 *
 * @internal
 */

import type { TokenUsage } from "../../types/usage.js";

interface StepUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
}

/**
 * Sums the per-step token counts of a multi-step run into one `TokenUsage`.
 *
 * Call `add` once per LLM finish, in any order, then `toTokenUsage` to read the total. The instance
 * is a running sum, not a snapshot: `toTokenUsage` may be called repeatedly and reflects everything
 * added so far, and there is no reset — start a new accumulator per run.
 *
 * Two shaping rules to expect in the output. The optional counters (cache read, cache write,
 * reasoning) are omitted entirely when they sum to zero rather than reported as `0`. And the
 * per-step `requests` array appears only when at least TWO steps were added, so a single-step run
 * carries totals alone.
 *
 * `totalTokens` is input plus output only — cache and reasoning counts are reported separately and
 * are not folded into it.
 */
export class UsageAccumulator {
  private input = 0;
  private output = 0;
  private cacheRead = 0;
  private cacheWrite = 0;
  private reasoning = 0;
  private readonly requests: Array<Omit<TokenUsage, "requests">> = [];

  add(step: StepUsage): void {
    const inputTokens = step.inputTokens ?? 0;
    const outputTokens = step.outputTokens ?? 0;
    const cacheReadTokens = step.cacheReadTokens ?? 0;
    const cacheWriteTokens = step.cacheWriteTokens ?? 0;
    const reasoningTokens = step.reasoningTokens ?? 0;
    this.input += inputTokens;
    this.output += outputTokens;
    this.cacheRead += cacheReadTokens;
    this.cacheWrite += cacheWriteTokens;
    this.reasoning += reasoningTokens;
    this.requests.push({
      inputTokens,
      outputTokens,
      ...(cacheReadTokens > 0 ? { cacheReadTokens } : {}),
      ...(cacheWriteTokens > 0 ? { cacheWriteTokens } : {}),
      ...(reasoningTokens > 0 ? { reasoningTokens } : {}),
      totalTokens: inputTokens + outputTokens,
    });
  }

  /** Did we observe any usage at all? */
  hasAny(): boolean {
    return this.requests.length > 0;
  }

  toTokenUsage(): TokenUsage {
    return {
      inputTokens: this.input,
      outputTokens: this.output,
      ...(this.cacheRead > 0 ? { cacheReadTokens: this.cacheRead } : {}),
      ...(this.cacheWrite > 0 ? { cacheWriteTokens: this.cacheWrite } : {}),
      ...(this.reasoning > 0 ? { reasoningTokens: this.reasoning } : {}),
      totalTokens: this.input + this.output,
      ...(this.requests.length > 1 ? { requests: this.requests.slice() } : {}),
    };
  }
}
