/**
 * Workflow errors must be visible to the SDK's own retry decision.
 *
 * `errors.ts` documents `isTransientError` as *"a single source of truth rather than a
 * re-derivation"* for retry, and it is `err instanceof TheokitAgentError && err.isRetryable`.
 * `Retry.create`'s default predicate IS that function. So a class outside the hierarchy is
 * permanent BY CONTRACT, whatever it actually represents.
 *
 * Every public workflow error extended plain `Error`, so the whole workflow surface sat outside.
 * A consumer wrapping `workflow.run()` in the SDK's own retry helper got `false` for every workflow
 * failure — including `WorkflowAlreadyRunningError`, which is precisely the try-again-in-a-moment
 * condition and was being classified as permanent.
 *
 * Reparenting is source-compatible: `TheokitAgentError extends Error`, so `instanceof Error` and
 * `err.name` consumers are untouched. What changes is that `code` and `isRetryable` now exist.
 *
 * The retryability of each class is a JUDGEMENT and is asserted here rather than left implicit,
 * because a wrong `true` costs a retry storm against a permanent failure and a wrong `false` costs
 * the retry the caller asked for.
 */
import { describe, expect, it } from "vitest";

import { isTransientError, TheokitAgentError } from "../../src/errors.js";
import {
  WorkflowAlreadyRunningError,
  WorkflowCompensateNotImplementedError,
  WorkflowDuplicateStepIdError,
  WorkflowInputError,
  WorkflowMaxIterationsExceededError,
  WorkflowNestedError,
  WorkflowNotSerializableError,
  WorkflowOutputError,
  WorkflowResumeStepNotFoundError,
  WorkflowSnapshotNotFoundError,
  WorkflowStateError,
} from "../../src/workflow-errors.js";

/** Each entry: an instance, its expected stable `code`, and whether a retry can help. */
const CASES: ReadonlyArray<{ err: Error; code: string; retryable: boolean; why: string }> = [
  {
    err: new WorkflowAlreadyRunningError("w", "r1"),
    code: "workflow_already_running",
    retryable: true,
    why: "another run holds the single-flight lock; it ends, and the next attempt succeeds",
  },
  {
    err: new WorkflowDuplicateStepIdError("s1"),
    code: "workflow_duplicate_step_id",
    retryable: false,
    why: "a build-time defect in the workflow definition — identical on every attempt",
  },
  {
    err: new WorkflowInputError("w", "bad"),
    code: "workflow_input_invalid",
    retryable: false,
    why: "the same input fails the same schema every time",
  },
  {
    err: new WorkflowOutputError("w", "bad"),
    code: "workflow_output_invalid",
    retryable: false,
    why: "schema validation, not a transient condition",
  },
  {
    err: new WorkflowStateError("w", "bad"),
    code: "workflow_state_invalid",
    retryable: false,
    why: "schema validation, not a transient condition",
  },
  {
    err: new WorkflowNestedError("s1", "child", "failed"),
    code: "workflow_nested_failed",
    retryable: false,
    why: "conservative: the child's own error decides, and it is not visible from here",
  },
  {
    err: new WorkflowSnapshotNotFoundError("r1"),
    code: "workflow_snapshot_not_found",
    retryable: false,
    why: "the snapshot is absent or already consumed; retrying looks for the same missing thing",
  },
  {
    err: new WorkflowMaxIterationsExceededError("s1", 10),
    code: "workflow_max_iterations_exceeded",
    retryable: false,
    why: "a deterministic loop bound — the same run exceeds it again",
  },
  {
    err: new WorkflowNotSerializableError("s1", new Error("a function is not JSON")),
    code: "workflow_not_serializable",
    retryable: false,
    why: "a structural property of the value, unchanged by waiting",
  },
  {
    err: new WorkflowResumeStepNotFoundError("s1", "w"),
    code: "workflow_resume_step_not_found",
    retryable: false,
    why: "the step id is absent from the definition — permanent",
  },
  {
    err: new WorkflowCompensateNotImplementedError("s1"),
    code: "workflow_compensate_not_implemented",
    retryable: false,
    why: "a deferred feature; no amount of retrying implements it",
  },
];

describe("public workflow errors are inside the SDK error hierarchy", () => {
  it.each(CASES.map((c) => [c.err.name, c] as const))("%s", (_name, c) => {
    expect(
      c.err,
      "outside TheokitAgentError, isTransientError is false BY CONTRACT whatever the error means",
    ).toBeInstanceOf(TheokitAgentError);
    expect(c.err, "reparenting must stay source-compatible for `instanceof Error`").toBeInstanceOf(
      Error,
    );
    expect((c.err as TheokitAgentError).code, "a stable code to branch on").toBe(c.code);
    expect(isTransientError(c.err), c.why).toBe(c.retryable);
  });

  it("the retryable one is genuinely distinguished, not blanket-true", () => {
    // A reparenting that made everything retryable would pass every case above except this one.
    const retryable = CASES.filter((c) => c.retryable);
    expect(retryable.length, "exactly one workflow error is a try-again condition").toBe(1);
    expect(retryable[0]?.err.name).toBe("WorkflowAlreadyRunningError");
  });
});
