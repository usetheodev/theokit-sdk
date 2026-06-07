/**
 * Shared subprocess-watch helpers for built-in coding tools (git-diff,
 * run-vitest). Wires the on(close)/on(error) settle pattern in a single
 * place to eliminate the cross-file clone flagged by jscpd.
 *
 * @internal
 */

import type { ChildProcess } from "node:child_process";

/**
 * Settle gate — guarantees the supplied callback fires exactly once across
 * the close/error/timeout race. Clears the timer on settle.
 */
interface SettleGate {
  /** True after first settle; subsequent calls are no-ops. */
  settled: () => boolean;
  /** Settle the gate, clear the timer, and call `onSettle()`. */
  fire: (onSettle: () => void) => void;
}

function createSettleGate(timer: NodeJS.Timeout): SettleGate {
  let done = false;
  return {
    settled: () => done,
    fire: (onSettle) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      onSettle();
    },
  };
}

/**
 * Wire SIGKILL-on-timeout for a detached process group. Returns the settle
 * gate so caller listeners can short-circuit when the timeout already fired.
 */
export function armTimeoutKill<T>(
  child: ChildProcess,
  timeoutMs: number,
  onTimeout: () => T,
  resolve: (value: T) => void,
): SettleGate {
  const timer = setTimeout(() => {
    gate.fire(() => {
      try {
        process.kill(-(child.pid ?? 0), "SIGKILL");
      } catch {
        /* already dead */
      }
      resolve(onTimeout());
    });
  }, timeoutMs);
  const gate = createSettleGate(timer);
  return gate;
}

/**
 * Attach a close+error pair of listeners that resolve via the supplied
 * callbacks. Honors the gate so timeout-vs-close races settle exactly once.
 */
export function attachChildSettlers<T>(
  child: ChildProcess,
  gate: SettleGate,
  onClose: (code: number | null) => T,
  onError: (err: Error) => T,
  resolve: (value: T) => void,
): void {
  child.on("close", (code) => {
    gate.fire(() => resolve(onClose(code)));
  });
  child.on("error", (err) => {
    gate.fire(() => resolve(onError(err)));
  });
}
