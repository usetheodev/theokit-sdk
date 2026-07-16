/**
 * SE2 — the `TaskEvent` → `task_*` RunEvent bridge for the opt-in `onRunEvent`
 * sink. Extracted from `registry.ts` (a pure, self-contained mapping) to keep
 * the registry within the G8 LoC budget and give the bridge one home.
 *
 * @internal
 */

import type { RunEvent } from "../../types/run-events.js";
import type { TaskEvent, TaskKind } from "../../types/task.js";

/** Map a `TaskEvent` to a `task_*` RunEvent, or `undefined` when it has no counterpart. */
export function taskEventToRunEvent(
  event: TaskEvent,
  taskId: string,
  kind: TaskKind,
): RunEvent | undefined {
  switch (event.type) {
    case "started":
      return { type: "task_started", taskId, description: kind };
    case "progress":
      return { type: "task_updated", taskId, status: "progress" };
    case "finished":
      return { type: "task_completed", taskId, status: "completed" };
    case "errored":
      return { type: "task_completed", taskId, status: "failed" };
    case "cancelled":
      return { type: "task_completed", taskId, status: "stopped" };
    default:
      return undefined; // `submitted` (queued) has no RunEvent counterpart
  }
}
