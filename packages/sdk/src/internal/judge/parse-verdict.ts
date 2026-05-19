/**
 * Pure verdict parser (T2.1, ADRs D120-D121).
 *
 * Strict prefix matching against `DONE:`, `CONTINUE:`, `SKIPPED:`. Reason
 * is the suffix, trimmed. Anything else is fail-safe: verdict = `continue`,
 * `parseFailed: true` — caller's max-consecutive-failure cap stops the
 * loop after N flakes.
 *
 * @internal
 */

import type { JudgeResult } from "./types.js";

const DONE_PREFIX = "DONE:";
const CONTINUE_PREFIX = "CONTINUE:";
const SKIPPED_PREFIX = "SKIPPED:";

export function parseVerdict(text: string): JudgeResult {
  const trimmed = text.trim();

  if (trimmed.startsWith(DONE_PREFIX)) {
    return {
      verdict: "done",
      reason: trimmed.slice(DONE_PREFIX.length).trim(),
      parseFailed: false,
    };
  }
  if (trimmed.startsWith(CONTINUE_PREFIX)) {
    return {
      verdict: "continue",
      reason: trimmed.slice(CONTINUE_PREFIX.length).trim(),
      parseFailed: false,
    };
  }
  if (trimmed.startsWith(SKIPPED_PREFIX)) {
    return {
      verdict: "skipped",
      reason: trimmed.slice(SKIPPED_PREFIX.length).trim(),
      parseFailed: false,
    };
  }

  // Fail-safe: ADR D121 — prefer "continue" so we don't stop prematurely.
  // The runUntil loop counts consecutive parseFailed responses and bails
  // after `maxConsecutiveJudgeFailures` (default 3).
  return {
    verdict: "continue",
    reason: `judge response malformed: "${trimmed.slice(0, 100)}"`,
    parseFailed: true,
  };
}
