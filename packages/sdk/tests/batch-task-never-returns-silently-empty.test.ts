/**
 * `Agent.batch({ task: true })` must never resolve with an empty array it did not earn.
 *
 * `wrapBatchAsTask` assigned `results` only inside the task's `work` callback and then returned it
 * unconditionally, so THREE different failures produced the same value:
 *
 *   1. the work threw          → the loop saw `state === "error"`, broke, and returned `[]`
 *   2. the task was cancelled  → same break, same `[]`
 *   3. the 5000-iteration poll budget elapsed → fell out of the loop, returned `[]`
 *
 * In every case the caller received a RESOLVED promise holding `[]`, indistinguishable from
 * `Agent.batch([])` on an empty input. Nothing threw, nothing logged, and the batch's own errors —
 * which the registry had already recorded as `{ code, message }` on the terminal event — were
 * discarded by a loop that read only `handle.state`.
 *
 * `rules/error-handling.md` is violated four ways at once here: the failure is not detected, not
 * reported, not typed, and returns a magic value instead of raising. That the magic value is a
 * plausible success is what makes it expensive: a caller iterating the results sees zero rows and
 * concludes the batch had nothing to do.
 *
 * The third case is gone rather than tested, and that is deliberate: the fixed budget was never a
 * safety net. 5000 iterations of a 5 ms sleep is ~25 s, and a batch legitimately longer than that
 * would trip it and return `[]` — the budget generated the bug it appeared to guard against. The
 * wait is now the task's own terminal event, whose lifecycle is the honest bound.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Agent } from "../src/agent.js";
import { TheokitAgentError } from "../src/errors.js";
import { batchImpl } from "../src/internal/agent/batch.js";
import { __resetTaskRegistryForTests } from "../src/internal/task/registry.js";
import { useTempCwd } from "./helpers/temp-workspace.js";

useTempCwd();

const FIXTURE_KEY = "theo_test_batch_silent";

describe("Agent.batch({ task: true }) surfaces failure instead of an empty array", () => {
  beforeEach(() => __resetTaskRegistryForTests());
  afterEach(() => __resetTaskRegistryForTests());

  it("a batch whose work throws rejects with a typed error, not []", async () => {
    // `options.filter` runs OUTSIDE runBatch's per-item try/catch (batch.ts:196), so a filter that
    // throws escapes `exec` and makes the task's `work` reject — the deterministic way to reach the
    // `errored` terminal state without racing a cancel or waiting out a poll budget.
    const promise = batchImpl(
      ["a", "b"],
      {
        apiKey: FIXTURE_KEY,
        model: { id: "openai/gpt-4o-mini" },
        local: { sandboxOptions: { enabled: false } },
        task: { id: "b-silent-failure" },
        filter: () => {
          throw new Error("filter blew up");
        },
      },
      { create: (opts) => Agent.create(opts) },
    );

    await expect(
      promise,
      "a failed batch task must REJECT — resolving with [] is indistinguishable from success on an " +
        "empty input, which is the defect this file exists to prevent",
    ).rejects.toBeInstanceOf(Error);

    const err = await promise.catch((e: unknown) => e);
    expect(
      err,
      "and it must be inside the SDK hierarchy so callers can branch on `code` rather than on prose",
    ).toBeInstanceOf(TheokitAgentError);
    expect((err as TheokitAgentError).code).toBe("batch_task_failed");
  });

  it("a successful batch still resolves with its rows", async () => {
    // The guard above must not have been bought by making the happy path throw too.
    const results = await Agent.batch(["one", "two"], {
      apiKey: FIXTURE_KEY,
      model: { id: "openai/gpt-4o-mini" },
      local: { sandboxOptions: { enabled: false } },
      concurrency: 2,
      task: true,
    });
    expect(results.length).toBe(2);
    expect(results.every((r) => r.ok)).toBe(true);
  });
});
