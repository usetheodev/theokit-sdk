/**
 * T2.2 step 4a/N — Compression decision logic (ADR D440).
 *
 * Pure function that determines whether the agent-loop should attempt
 * context-window compression on a given error. Isolates the decision
 * matrix from the loop.ts hot path so it's independently testable.
 *
 * @internal
 */

/**
 * Mutable compression state tracked across retries within a single
 * `Agent.send()` invocation. Populated from `ResolvedCompressionConfig`
 * at the start of the loop; mutated by the compression attempt path.
 *
 * @internal
 */
export interface CompressionState {
  enabled: boolean;
  graceRemaining: number;
  attemptsUsed: number;
  maxAttempts: number;
}

/**
 * Should the agent-loop attempt context-window compression?
 *
 * Decision matrix (per ADR D440):
 *   1. Error code is NOT `context_too_long` → false
 *   2. Compression not enabled → false
 *   3. Grace period not exhausted → false (decrement grace, let caller retry without compression)
 *   4. Attempt count ≥ maxAttempts → false (cap reached, propagate the error)
 *   5. All checks pass → true (attempt compression)
 *
 * @internal
 */
export function shouldAttemptCompression(
  errorCode: string | undefined,
  state: CompressionState,
): boolean {
  if (errorCode !== "context_too_long") return false;
  if (!state.enabled) return false;
  if (state.graceRemaining > 0) return false;
  if (state.attemptsUsed >= state.maxAttempts) return false;
  return true;
}
