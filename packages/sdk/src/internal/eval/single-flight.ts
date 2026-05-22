/**
 * D213 — single-flight guard for `Eval.run`. Module-level `Set<string>`
 * tracks running names; `acquire` throws on collision; `release` is
 * idempotent.
 *
 * @internal
 */

const RUNNING = new Set<string>();

export class EvalAlreadyRunningError extends Error {
  override readonly name = "EvalAlreadyRunningError";
  readonly evalName: string;
  constructor(evalName: string) {
    super(
      `Eval "${evalName}" is already running in this process. Use a unique name per concurrent run (D213).`,
    );
    this.evalName = evalName;
  }
}

export function acquireSingleFlight(name: string): void {
  if (RUNNING.has(name)) {
    throw new EvalAlreadyRunningError(name);
  }
  RUNNING.add(name);
}

export function releaseSingleFlight(name: string): void {
  RUNNING.delete(name);
}

/** Test-only — clears the running set. NOT exported via barrel. */
export function __resetSingleFlightForTests(): void {
  RUNNING.clear();
}
