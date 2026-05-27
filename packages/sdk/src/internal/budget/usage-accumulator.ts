/**
 * UsageAccumulator — aggregate multi-step `LlmFinish` token counts
 * into a canonical `TokenUsage` (ADR D376, mirror openai-agents-python
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
