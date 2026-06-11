export type RunStateValue = "idle" | "busy" | "error";

export class RunStateBusyError extends Error {
  constructor() {
    super("Cannot start: run is already busy");
    this.name = "RunStateBusyError";
  }
}

export class RunStateInvalidTransitionError extends Error {
  constructor(from: RunStateValue, action: string) {
    super(`Invalid transition: cannot ${action} from "${from}"`);
    this.name = "RunStateInvalidTransitionError";
  }
}

/**
 * Tracks the lifecycle of a single agent run:
 * idle -> busy -> idle (complete) | error
 *
 * EC-4: allows recovery from error state via start().
 */
export class RunState {
  private _state: RunStateValue = "idle";
  private _error: Error | undefined;

  get state(): RunStateValue {
    return this._state;
  }

  get error(): Error | undefined {
    return this._error;
  }

  /** Transition from idle or error to busy. Throws if already busy. */
  start(): void {
    if (this._state === "busy") {
      throw new RunStateBusyError();
    }
    this._state = "busy";
    this._error = undefined;
  }

  /** Transition from busy to idle. */
  complete(): void {
    if (this._state !== "busy") {
      throw new RunStateInvalidTransitionError(this._state, "complete");
    }
    this._state = "idle";
  }

  /** Transition from busy to error. */
  fail(error: Error): void {
    if (this._state !== "busy") {
      throw new RunStateInvalidTransitionError(this._state, "fail");
    }
    this._state = "error";
    this._error = error;
  }

  /** Cancel a busy run, returning to idle. */
  cancel(): void {
    if (this._state !== "busy") {
      throw new RunStateInvalidTransitionError(this._state, "cancel");
    }
    this._state = "idle";
  }
}
