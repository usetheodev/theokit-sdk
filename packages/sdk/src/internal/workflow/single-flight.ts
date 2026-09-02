/**
 * Single-flight registry for in-flight workflow runs (ADR D242).
 *
 * Key = `${workflowId}:${runId}`. Throws `WorkflowAlreadyRunningError` on
 * duplicate. Process crash auto-releases (in-memory map). Pattern mirrors
 * `internal/eval/single-flight.ts` (D213).
 *
 * EC-5 absorbed: lock uses `workflowId` (minted at `.commit()`), not the
 * user-supplied `name`, so two `Workflow` instances sharing a name don't
 * collide on each other's locks.
 *
 * @internal
 */

import { WorkflowAlreadyRunningError } from "../../workflow-errors.js";

interface Flight {
  controller: AbortController;
}

const registry = new Map<string, Flight>();

function key(workflowId: string, runId: string): string {
  return `${workflowId}:${runId}`;
}

export interface AcquiredFlight {
  signal: AbortSignal;
  release: () => void;
}

export function acquireSingleFlight(
  workflowId: string,
  runId: string,
  workflowName: string,
): AcquiredFlight {
  const k = key(workflowId, runId);
  if (registry.has(k)) {
    throw new WorkflowAlreadyRunningError(workflowName, runId);
  }
  const controller = new AbortController();
  registry.set(k, { controller });
  return {
    signal: controller.signal,
    release: () => {
      registry.delete(k);
    },
  };
}
