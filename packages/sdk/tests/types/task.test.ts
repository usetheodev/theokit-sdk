/**
 * Phase 1 (T1.1) RED tests for the public Task type contract.
 * Lifecycle invariants checked statically + runtime guard for the
 * task-id grammar (D368, EC-5).
 */

import { describe, expect, it } from "vitest";

import {
  InvalidTaskIdError,
  TaskNotFoundError,
  UnsupportedTaskOperationError,
} from "../../src/errors.js";
import { isValidTaskId, TASK_RESERVED_PREFIXES } from "../../src/internal/task/task-id.js";
import type { TaskEvent, TaskHandle, TaskKind, TaskState } from "../../src/types/task.js";

describe("TaskState — closed 5-value enum (D362)", () => {
  it("includes exactly the 5 documented states", () => {
    const sample: TaskState[] = ["queued", "running", "finished", "error", "cancelled"];
    expect(sample.length).toBe(5);
    // Compile-time exhaustive check: switch over every state must be `never` at default.
    function exhaustive(s: TaskState): string {
      switch (s) {
        case "queued":
          return "q";
        case "running":
          return "r";
        case "finished":
          return "f";
        case "error":
          return "e";
        case "cancelled":
          return "c";
        default: {
          const _never: never = s;
          throw new Error(`unreachable: ${_never as string}`);
        }
      }
    }
    expect(sample.map(exhaustive).join("")).toBe("qrfec");
  });
});

describe("TaskEvent — discriminated union (D366)", () => {
  it("exhaustive switch over every event type compiles + matches", () => {
    const submitted: TaskEvent = {
      type: "submitted",
      taskId: "t-1",
      kind: "run" satisfies TaskKind,
      submittedAt: Date.now(),
    };
    const started: TaskEvent = { type: "started", taskId: "t-1", startedAt: Date.now() };
    const progress: TaskEvent = {
      type: "progress",
      taskId: "t-1",
      at: Date.now(),
      payload: { chunk: "hi" },
    };
    const finished: TaskEvent = {
      type: "finished",
      taskId: "t-1",
      finishedAt: Date.now(),
      result: "ok",
    };
    const errored: TaskEvent = {
      type: "errored",
      taskId: "t-1",
      erroredAt: Date.now(),
      error: { code: "boom", message: "boom" },
    };
    const cancelled: TaskEvent = {
      type: "cancelled",
      taskId: "t-1",
      cancelledAt: Date.now(),
      reason: "user",
    };

    function visit(e: TaskEvent): string {
      switch (e.type) {
        case "submitted":
          return `submitted:${e.kind}`;
        case "started":
          return "started";
        case "progress":
          return "progress";
        case "finished":
          return "finished";
        case "errored":
          return `errored:${e.error.code}`;
        case "cancelled":
          return "cancelled";
        default: {
          const _never: never = e;
          throw new Error(`unreachable: ${(_never as { type: string }).type}`);
        }
      }
    }

    expect([submitted, started, progress, finished, errored, cancelled].map(visit).join(",")).toBe(
      "submitted:run,started,progress,finished,errored:boom,cancelled",
    );
  });
});

describe("TaskHandle — optional cancelRequested field (EC-7)", () => {
  it("accepts handle with cancelRequested flag set", () => {
    const h: TaskHandle = {
      id: "t-1",
      kind: "custom",
      state: "running",
      submittedAt: 0,
      cancelRequested: true,
    };
    expect(h.cancelRequested).toBe(true);
  });

  it("accepts handle without cancelRequested field", () => {
    const h: TaskHandle = { id: "t-1", kind: "custom", state: "queued", submittedAt: 0 };
    expect(h.cancelRequested).toBeUndefined();
  });
});

describe("isValidTaskId — D368 grammar + EC-5 reserved prefixes", () => {
  it("accepts lowercase alphanumeric with dash/underscore", () => {
    expect(isValidTaskId("abc", false)).toBe(true);
    expect(isValidTaskId("a1b-c_d", false)).toBe(true);
    expect(isValidTaskId("0", false)).toBe(true);
    expect(isValidTaskId("a", false)).toBe(true);
  });

  it("rejects uppercase / spaces / dots / special chars", () => {
    expect(isValidTaskId("ABC", false)).toBe(false);
    expect(isValidTaskId("a b", false)).toBe(false);
    expect(isValidTaskId("a.b", false)).toBe(false);
    expect(isValidTaskId("../bad", false)).toBe(false);
    expect(isValidTaskId("", false)).toBe(false);
  });

  it("rejects IDs starting with a dash or underscore", () => {
    expect(isValidTaskId("-abc", false)).toBe(false);
    expect(isValidTaskId("_abc", false)).toBe(false);
  });

  it("rejects reserved prefixes wf- / b- / cron- in user-supplied mode (EC-5)", () => {
    expect(isValidTaskId("wf-foo", false)).toBe(false);
    expect(isValidTaskId("b-foo", false)).toBe(false);
    expect(isValidTaskId("cron-foo", false)).toBe(false);
  });

  it("permits reserved prefixes in adapter mode (allowReserved=true)", () => {
    expect(isValidTaskId("wf-foo", true)).toBe(true);
    expect(isValidTaskId("b-foo", true)).toBe(true);
    expect(isValidTaskId("cron-job-1700000000000", true)).toBe(true);
  });

  it("RESERVED_PREFIXES exports the 3 documented values", () => {
    expect([...TASK_RESERVED_PREFIXES].sort()).toEqual(["b-", "cron-", "wf-"]);
  });
});

describe("Task errors carry the documented code", () => {
  it("InvalidTaskIdError has code='invalid_task_id'", () => {
    const e = new InvalidTaskIdError("bad", "ABC");
    expect(e.code).toBe("invalid_task_id");
    expect(e.taskId).toBe("ABC");
    expect(e.name).toBe("InvalidTaskIdError");
  });

  it("TaskNotFoundError has code='task_not_found'", () => {
    const e = new TaskNotFoundError("missing");
    expect(e.code).toBe("task_not_found");
    expect(e.taskId).toBe("missing");
  });

  it("UnsupportedTaskOperationError has code='task_op_unsupported'", () => {
    const e = new UnsupportedTaskOperationError("submit");
    expect(e.code).toBe("task_op_unsupported");
    expect(e.operation).toBe("submit");
  });
});
