/**
 * Local cron scheduler state — a process-wide singleton flipped by
 * `Cron.start()` / `Cron.stop()`. Phase 1 holds just the running flag and
 * the workspace it was started for; actual fire timing arrives with the
 * full local runtime adapter.
 *
 * @internal
 */

interface SchedulerState {
  running: boolean;
  cwd?: string;
}

const state: SchedulerState = { running: false };

/** Activate the scheduler. Returns the new state. @internal */
export function startScheduler(cwd?: string): void {
  state.running = true;
  if (cwd !== undefined) state.cwd = cwd;
}

/** Deactivate the scheduler. Jobs are preserved. @internal */
export function stopScheduler(): void {
  state.running = false;
}

/** Snapshot of the scheduler's running flag and configured workspace. @internal */
export function getSchedulerState(): { running: boolean; cwd?: string } {
  return { running: state.running, cwd: state.cwd };
}
