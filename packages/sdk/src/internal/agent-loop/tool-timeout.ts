/**
 * #58 — bound a single tool execution by the run's cancellation signal and an
 * optional per-tool timeout, so a hung tool cannot wedge the agent loop and a
 * cancelled run interrupts an in-flight tool.
 *
 * Stdlib only (`AbortSignal.any` / `AbortSignal.timeout`, Node ≥22.12).
 *
 * @internal
 */

import type { ToolResult } from "./tool-executors.js";

export interface ToolRaceOptions {
  /** The run's cancellation signal (`AgentLoopInputs.signal`). */
  signal?: AbortSignal;
  /** Per-tool timeout in ms. Omit for no timeout. */
  timeoutMs?: number;
}

/** Exit code used for a tool that was aborted/timed out (matches the sandbox 124). */
const TOOL_ABORTED_EXIT = 124;

function abortedResult(signal: AbortSignal): ToolResult {
  const reason = signal.reason as { name?: string } | undefined;
  const timedOut = reason?.name === "TimeoutError";
  return {
    stdout: "",
    stderr: timedOut ? "tool execution timed out" : "tool execution aborted",
    exitCode: TOOL_ABORTED_EXIT,
  };
}

/**
 * Race a tool execution against cancellation + an optional timeout. Returns the
 * tool's result if it finishes first, or a typed aborted/timed-out `ToolResult`
 * (exit 124) if the run is cancelled or the per-tool deadline elapses. When
 * neither a signal nor a timeout is supplied, the execution is returned as-is
 * (zero overhead, backward-compatible).
 */
export function raceToolExecution(
  exec: Promise<ToolResult>,
  opts: ToolRaceOptions,
): Promise<ToolResult> {
  const { signal, timeoutMs } = opts;
  if (signal === undefined && timeoutMs === undefined) return exec;

  const signals: AbortSignal[] = [];
  if (signal !== undefined) signals.push(signal);
  if (timeoutMs !== undefined) signals.push(AbortSignal.timeout(timeoutMs));
  const merged = signals.length === 1 ? signals[0]! : AbortSignal.any(signals);

  if (merged.aborted) return Promise.resolve(abortedResult(merged));

  // ARCH-03 — attach the listener to a per-call controller, not the caller's
  // long-lived run signal, and remove it once the race settles, so tool-heavy
  // runs do not accumulate listeners on the shared signal.
  return new Promise<ToolResult>((resolve, reject) => {
    let settled = false;
    const onAbort = (): void => {
      if (settled) return;
      settled = true;
      resolve(abortedResult(merged));
    };
    merged.addEventListener("abort", onAbort, { once: true });
    exec.then(
      (r) => {
        if (settled) return;
        settled = true;
        merged.removeEventListener("abort", onAbort);
        resolve(r);
      },
      (e) => {
        if (settled) return;
        settled = true;
        merged.removeEventListener("abort", onAbort);
        // Preserve the original rejection (existing dispatch error handling catches it).
        reject(e);
      },
    );
  });
}
